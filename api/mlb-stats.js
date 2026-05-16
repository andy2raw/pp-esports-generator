// GET /api/mlb-stats?name=PlayerName&statType=Hits&line=0.5
// Uses the public MLB Stats API (no auth required).

const cache = new Map()
const CACHE_TTL = 5 * 60_000

// PrizePicks stat type → MLB Stats API { group, field }
const MLB_STAT_MAP = {
  'Hits':           { group: 'hitting',  field: 'hits' },
  'Home Runs':      { group: 'hitting',  field: 'homeRuns' },
  'RBIs':           { group: 'hitting',  field: 'rbi' },
  'Total Bases':    { group: 'hitting',  field: 'totalBases' },
  'Runs':           { group: 'hitting',  field: 'runs' },
  'Walks':          { group: 'hitting',  field: 'baseOnBalls' },
  'Strikeouts':     { group: 'pitching', field: 'strikeOuts' },
  'Pitching Outs':  { group: 'pitching', field: 'outs' },
  'Hits+Runs+RBIs': { group: 'hitting',  field: 'hits' },
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }

function _logFactorial(n) {
  if (n <= 1) return 0
  let r = 0
  for (let i = 2; i <= n; i++) r += Math.log(i)
  return r
}
function _poissonP(lambda, k) {
  if (lambda <= 0) return 0
  return Math.exp(-lambda + k * Math.log(lambda) - _logFactorial(k))
}
function _poissonCDF(lambda, k) {
  let c = 0
  for (let i = 0; i <= Math.floor(k); i++) c += _poissonP(lambda, i)
  return Math.min(c, 1)
}
function poissonOverProb(lambda, line) { return 1 - _poissonCDF(lambda, Math.floor(line)) }
function poissonUnderProb(lambda, line) { return _poissonCDF(lambda, Math.floor(line)) }

async function safeFetch(url) {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 7000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    if (!res.ok) {
      console.log(`[mlb safeFetch] ${res.status} ${url.slice(0, 80)}`)
      return null
    }
    return res.json().catch(() => null)
  } catch (e) {
    console.log(`[mlb safeFetch] error: ${e.message}`)
    return null
  }
}

async function searchPlayer(name) {
  const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportId=1`
  const data = await safeFetch(url)
  if (!data?.people?.length) return null
  const nl = name.toLowerCase()
  return (
    data.people.find(p => p.fullName?.toLowerCase() === nl) ||
    data.people.find(p => p.fullName?.toLowerCase().includes(nl.split(' ').slice(-1)[0])) ||
    data.people[0]
  )
}

function calcProb(line, l5Avg, seasonAvg) {
  if (!line || line <= 0) return { prob: 0.54, sharp: false }
  if (l5Avg == null && seasonAvg == null) return { prob: 0.54, sharp: false }
  const lambda = (l5Avg != null && seasonAvg != null)
    ? l5Avg * 0.6 + seasonAvg * 0.4
    : (l5Avg ?? seasonAvg)
  const overProb  = poissonOverProb(lambda, line)
  const underProb = poissonUnderProb(lambda, line)
  const direction = overProb >= underProb ? 'OVER' : 'UNDER'
  const prob = Math.max(0.35, Math.min(0.92, direction === 'OVER' ? overProb : underProb))
  const sharp = lambda >= line * 2.0
  console.log(`[poisson-mlb] lambda=${lambda.toFixed(3)} line=${line} direction=${direction} prob=${prob.toFixed(3)}`)
  return { prob, sharp }
}

export default async function handler(req, res) {
  const { name, statType, line: lineStr } = req.query || {}
  const line = parseFloat(lineStr) || 0
  if (!name) return res.status(400).json({ error: 'name required' })

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  const cacheKey = `${name}:${statType}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    const { prob, sharp } = calcProb(line, hit.data.last5Avg, hit.data.seasonAvg)
    return res.json({ ...hit.data, probability: prob, sharp })
  }

  const statDef = MLB_STAT_MAP[statType]
  if (!statDef) {
    console.log(`[mlb] unknown statType="${statType}" for "${name}"`)
    return res.json({ seasonAvg: null, last5Avg: null, source: null, probability: 0.54 })
  }

  const player = await searchPlayer(name)
  if (!player) {
    console.log(`[mlb] player not found: "${name}"`)
    return res.json({ seasonAvg: null, last5Avg: null, source: null, probability: 0.54 })
  }

  console.log(`[mlb] found player "${player.fullName}" id=${player.id}`)

  const { group, field } = statDef
  const season = new Date().getFullYear()

  // Season totals → per-game average
  const seasonData = await safeFetch(
    `https://statsapi.mlb.com/api/v1/people/${player.id}/stats?stats=season&group=${group}&season=${season}&sportId=1`,
  )
  const seasonSplit = seasonData?.stats?.[0]?.splits?.[0]?.stat
  const gamesPlayed = Math.max(1, seasonSplit?.gamesPlayed ?? seasonSplit?.gamesStarted ?? 1)
  const seasonTotal = seasonSplit?.[field]
  const seasonAvg   = seasonTotal != null ? +(seasonTotal / gamesPlayed).toFixed(3) : null

  // Game log → last 5 game values
  const gameLogData = await safeFetch(
    `https://statsapi.mlb.com/api/v1/people/${player.id}/stats?stats=gameLog&group=${group}&season=${season}&sportId=1`,
  )
  const splits      = gameLogData?.stats?.[0]?.splits || []
  const recent      = splits.slice(-5).map(s => s.stat?.[field]).filter(v => v != null && v >= 0)
  const last5Avg    = recent.length ? +(avg(recent)).toFixed(3) : null

  const result = { seasonAvg, last5Avg, source: 'mlb-stats' }
  console.log(
    `[mlb] "${name}" ${statType} → l5=${last5Avg ?? '-'} szn=${seasonAvg ?? '-'} (${group}/${field})`,
  )

  cache.set(cacheKey, { data: result, ts: Date.now() })
  const { prob, sharp } = calcProb(line, last5Avg, seasonAvg)
  return res.json({ ...result, probability: prob, sharp })
}
