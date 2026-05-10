// GET /api/esports-stats?name=PlayerName&game=LOL&statType=Kills
// Returns { seasonAvg, last5Avg, source } or { seasonAvg: null, last5Avg: null, source: null }

const cache = new Map()
const CACHE_TTL = 5 * 60_000

function getCached(key) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : undefined
}
function setCached(key, data) { cache.set(key, { data, ts: Date.now() }) }

async function safeFetch(url, timeoutMs = 6000) {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    if (!res.ok) return null
    return res.json().catch(() => null)
  } catch {
    return null
  }
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }

// ── LOL — Leaguepedia (lol.fandom.com) Cargo API ─────────────────────────────
const LOL_FIELD_MAP = {
  'Kills':       'Kills',
  'Deaths':      'Deaths',
  'Assists':     'Assists',
  'CS':          'CS',
  'Gold Earned': 'Gold',
}

async function getLolStats(name, statType) {
  const field = LOL_FIELD_MAP[statType]
  if (!field) return null

  // Try name variants: original, Title Case (On vs ON), lowercase
  const variants = [...new Set([
    name,
    name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
    name.toLowerCase(),
  ])]

  for (const v of variants) {
    const params = new URLSearchParams({
      action:   'cargoquery',
      tables:   'ScoreboardPlayers',
      fields:   `Link,${field}`,
      where:    `Link="${v}"`,
      order_by: 'DateTime_UTC DESC',
      limit:    '10',
      format:   'json',
    })
    const data = await safeFetch(`https://lol.fandom.com/api.php?${params}`)
    const rows = data?.cargoquery
    if (!rows?.length) continue

    const values = rows.map(r => parseFloat(r.title?.[field])).filter(v2 => !isNaN(v2) && v2 >= 0)
    if (!values.length) continue

    return { last5Avg: avg(values.slice(0, 5)), seasonAvg: avg(values), source: 'leaguepedia' }
  }
  return null
}

// ── DOTA2 — OpenDota API ──────────────────────────────────────────────────────
const DOTA2_FIELD_MAP = {
  'Kills':        'kills',
  'Deaths':       'deaths',
  'Assists':      'assists',
  'Last Hits':    'last_hits',
  'Gold Per Min': 'gold_per_min',
}

async function getDota2Stats(name, statType) {
  const field = DOTA2_FIELD_MAP[statType]
  if (!field) return null

  const results = await safeFetch(
    `https://api.opendota.com/api/search?q=${encodeURIComponent(name)}`,
  )
  if (!results?.length) return null

  const nl = name.toLowerCase()
  const player =
    results.find(p => p.personaname?.toLowerCase() === nl) ||
    results.find(p => p.personaname?.toLowerCase().includes(nl)) ||
    results[0]

  const matches = await safeFetch(
    `https://api.opendota.com/api/players/${player.account_id}/recentMatches`,
  )
  if (!Array.isArray(matches) || !matches.length) return null

  const values = matches.slice(0, 10).map(m => m[field]).filter(v => v != null && v >= 0)
  if (!values.length) return null

  return { last5Avg: avg(values.slice(0, 5)), seasonAvg: avg(values), source: 'opendota' }
}

// ── CSGO/CS2 — HLTV unofficial API ───────────────────────────────────────────
// hltv-api.vercel.app is a community proxy; response shapes vary by deployment.
// We attempt a few URL patterns and extract whatever we can.
async function getCsgoStats(name, statType) {
  if (statType !== 'Kills' && statType !== 'Deaths' && statType !== 'Assists' && statType !== 'Headshots') return null

  // Attempt 1: /api/player?name=
  let data = await safeFetch(
    `https://hltv-api.vercel.app/api/player?name=${encodeURIComponent(name)}`,
  )

  // Attempt 2: /api/getPlayer?name=
  if (!data) {
    data = await safeFetch(
      `https://hltv-api.vercel.app/api/getPlayer?name=${encodeURIComponent(name)}`,
    )
  }

  if (!data) return null

  // Extract stats from various response shapes
  const stats = data.stats || data.statistics || data
  const fieldMap = {
    Kills:     ['kills', 'kills_per_round', 'killsPerRound', 'k'],
    Deaths:    ['deaths', 'deaths_per_round'],
    Assists:   ['assists', 'assistsPerRound'],
    Headshots: ['headshots', 'hs_pct', 'headshot_pct'],
  }
  for (const key of (fieldMap[statType] || [])) {
    const v = parseFloat(stats[key])
    if (!isNaN(v) && v >= 0) return { last5Avg: null, seasonAvg: v, source: 'hltv' }
  }
  return null
}

// ── VAL — vlrggapi community proxy ────────────────────────────────────────────
async function getValStats(name, statType) {
  if (!['Kills', 'Deaths', 'Assists'].includes(statType)) return null

  // vlrggapi /stats returns an array of top players with per-map averages
  const data = await safeFetch('https://vlrggapi.vercel.app/stats?region=all&timespan=all')
  const segments = data?.data?.segments ?? data?.segments ?? []
  if (!segments.length) return null

  const nl = name.toLowerCase()
  const player =
    segments.find(p => p.player?.toLowerCase() === nl) ||
    segments.find(p => p.player?.toLowerCase().includes(nl))
  if (!player) return null

  const fieldMap = { Kills: 'kd', Deaths: 'd', Assists: 'a' }
  // vlrggapi exposes per-map k/d; use acs as proxy for kills when field missing
  const raw = player[fieldMap[statType]] ?? player['k'] ?? player['acs']
  const v = parseFloat(raw)
  if (isNaN(v)) return null

  return { last5Avg: null, seasonAvg: v, source: 'vlrgg' }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { name, game, statType } = req.query || {}
  if (!name || !game) return res.status(400).json({ error: 'name and game required' })

  // Combo picks like "Sasi + climber + Saber" — no individual stats possible
  if (name.includes('+') || name.includes('&')) {
    return res.json({ seasonAvg: null, last5Avg: null, source: null })
  }

  const cacheKey = `${game.toUpperCase()}:${name}:${statType}`
  const cached = getCached(cacheKey)
  if (cached !== undefined) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    return res.json(cached)
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    let result = null
    const g = (game || '').toUpperCase()

    if (g === 'LOL')                 result = await getLolStats(name, statType)
    else if (g === 'DOTA2')          result = await getDota2Stats(name, statType)
    else if (g === 'CSGO' || g === 'CS2') result = await getCsgoStats(name, statType)
    else if (g === 'VAL')            result = await getValStats(name, statType)

    const out = result ?? { seasonAvg: null, last5Avg: null, source: null }
    console.log(`[esports-stats] ${g} "${name}" ${statType} → ${out.source || 'miss'} l5=${out.last5Avg?.toFixed(1) ?? '-'} szn=${out.seasonAvg?.toFixed(1) ?? '-'}`)
    setCached(cacheKey, out)
    return res.json(out)
  } catch (e) {
    console.error(`[esports-stats] error ${game} "${name}":`, e.message)
    const out = { seasonAvg: null, last5Avg: null, source: null }
    setCached(cacheKey, out)
    return res.json(out)
  }
}
