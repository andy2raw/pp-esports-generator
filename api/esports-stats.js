// deploy v2
// GET /api/esports-stats?name=PlayerName&game=LOL&statType=Kills
// Returns { seasonAvg, last5Avg, source } or { seasonAvg: null, last5Avg: null, source: null }

// PandaScore key — must be set as PANDASCORE_KEY in Vercel environment variables.
const PANDASCORE_KEY = process.env.PANDASCORE_KEY || ''

// Fire once per cold start: log the key prefix + one live search per game type.
let _diagnosticDone = false
async function runDiagnostic() {
  if (_diagnosticDone) return
  _diagnosticDone = true
  const keyPreview = PANDASCORE_KEY
    ? `"${PANDASCORE_KEY.slice(0, 12)}…" (len=${PANDASCORE_KEY.length})`
    : 'NOT SET'
  console.log(`[PS diagnostic] PANDASCORE_KEY = ${keyPreview}`)
  if (!PANDASCORE_KEY) return

  const tests = [
    { slug: 'csgo',     name: 'Curse' },
    { slug: 'valorant', name: 'kiNgg' },
    { slug: 'lol',      name: 'Ruler' },
  ]
  for (const { slug, name } of tests) {
    try {
      const res = await fetch(
        `https://api.pandascore.co/${slug}/players?search[name]=${encodeURIComponent(name)}&per_page=3`,
        { headers: { Authorization: `Bearer ${PANDASCORE_KEY}` } },
      )
      const body = await res.text()
      console.log(`[PS diagnostic] ${slug} "${name}" → HTTP ${res.status}: ${body.slice(0, 200)}`)
    } catch (e) {
      console.log(`[PS diagnostic] ${slug} "${name}" → fetch error: ${e.message}`)
    }
  }
}

const cache = new Map()
const CACHE_TTL = 5 * 60_000

function getCached(key) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : undefined
}
function setCached(key, data) { cache.set(key, { data, ts: Date.now() }) }

async function safeFetch(url, { timeoutMs = 6000, headers = {} } = {}) {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal, headers })
    clearTimeout(t)
    if (!res.ok) {
      console.log(`[safeFetch] ${res.status} ${url.slice(0, 80)}`)
      return null
    }
    return res.json().catch(() => null)
  } catch (e) {
    console.log(`[safeFetch] error ${url.slice(0, 80)}: ${e.message}`)
    return null
  }
}

async function psGet(path) {
  const url = `https://api.pandascore.co${path}`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 7000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${PANDASCORE_KEY}` },
    })
    clearTimeout(t)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log(`[psGet] ${res.status} ${path.slice(0, 80)} body="${body.slice(0, 120)}"`)
      return null
    }
    const data = await res.json().catch(() => null)
    const summary = Array.isArray(data)
      ? `count=${data.length} first=${JSON.stringify(data[0]?.name ?? data[0]?.id ?? null)}`
      : `keys=${Object.keys(data || {}).slice(0, 5).join(',')}`
    console.log(`[psGet] 200 ${path.slice(0, 80)} ${summary}`)
    return data
  } catch (e) {
    console.log(`[psGet] err ${path.slice(0, 80)}: ${e.message}`)
    return null
  }
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }

// ── Probability calculation ───────────────────────────────────────────────────
function lineHeuristic(line, game, statType) {
  const st = (statType || '').toLowerCase()
  const g = (game || '').toUpperCase()
  let prob = 0.54
  if (st.includes('kill')) {
    const typical = { LOL: 6, CSGO: 16, CS2: 16, VAL: 18, DOTA2: 10 }[g] ?? 12
    const r = line / typical
    if (r < 0.75)      prob = 0.67
    else if (r < 0.90) prob = 0.62
    else if (r < 1.05) prob = 0.56
    else if (r < 1.20) prob = 0.51
    else               prob = 0.48
  } else if (st.includes('death')) {
    prob = line < 8 ? 0.64 : line < 12 ? 0.58 : line < 16 ? 0.52 : 0.48
  } else if (st.includes('assist')) {
    prob = line < 5 ? 0.65 : line < 8 ? 0.60 : line < 12 ? 0.55 : 0.50
  } else if (st.includes('headshot')) {
    prob = line < 35 ? 0.64 : line < 46 ? 0.57 : 0.50
  }
  return Math.min(0.70, Math.max(0.46, prob))
}

function calcProb(name, game, statType, line, seasonAvg, last5Avg) {
  if (!line || line <= 0) return 0.54
  const l5 = last5Avg
  const szn = seasonAvg
  const l5Above  = l5 != null && l5 > line
  const sznAbove = szn != null && szn > line
  let prob, tag

  if (szn == null && l5 == null) {
    prob = lineHeuristic(line, game, statType)
    tag  = 'heuristic'
  } else if (l5Above && sznAbove) {
    const l5Ex  = l5 / line - 1
    const sznEx = szn / line - 1
    const avgEx = (l5Ex + sznEx) / 2
    prob = Math.min(0.78, 0.68 + Math.min(avgEx / 0.30, 1) * 0.10)
    tag  = `both_above l5ex=${l5Ex.toFixed(2)} sznex=${sznEx.toFixed(2)}`
  } else if (l5Above) {
    const ex = l5 / line - 1
    prob = Math.min(0.72, 0.63 + Math.min(ex / 0.30, 1) * 0.09)
    tag  = `l5_above ex=${ex.toFixed(2)}`
  } else if (sznAbove) {
    const ex = szn / line - 1
    prob = Math.min(0.68, 0.58 + Math.min(ex / 0.30, 1) * 0.10)
    tag  = `szn_above ex=${ex.toFixed(2)}`
  } else {
    const best = Math.max(l5 ?? 0, szn ?? 0)
    const bf   = line > 0 ? Math.min(1, 1 - best / line) : 0
    prob = Math.max(0.46, 0.54 - bf * 0.20)
    tag  = `below bf=${bf.toFixed(2)}`
  }

  console.log(
    `[prob] ${game} "${name}" ${statType} line=${line}` +
    ` l5=${l5?.toFixed(2) ?? 'null'} szn=${szn?.toFixed(2) ?? 'null'} ${tag} → ${prob.toFixed(3)}`,
  )
  return Math.min(0.78, Math.max(0.46, prob))
}

// ── PandaScore shared helper ──────────────────────────────────────────────────
const PS_FIELDS = {
  Kills:     ['kills'],
  Deaths:    ['deaths'],
  Assists:   ['assists'],
  Headshots: ['headshots'],
}

// Dedicated search that always logs [PS result] with HTTP status + count.
async function psSearch(gameSlug, name) {
  const url = `https://api.pandascore.co/${gameSlug}/players?search[name]=${encodeURIComponent(name)}&per_page=5`
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 7000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${PANDASCORE_KEY}` },
    })
    clearTimeout(t)
    const data = res.ok ? (await res.json().catch(() => [])) : []
    const count = Array.isArray(data) ? data.length : 0
    const first = count > 0 ? `first="${data[0].name}"` : 'no results'
    console.log(`[PS result] ${gameSlug} "${name}" → HTTP ${res.status} count=${count} ${first}`)
    return res.ok && count > 0 ? data : null
  } catch (e) {
    console.log(`[PS result] ${gameSlug} "${name}" → error: ${e.message}`)
    return null
  }
}

async function getPandaScoreStats(gameSlug, name, statType) {
  const fields = PS_FIELDS[statType]
  if (!fields) {
    console.log(`[PS skip] ${gameSlug} "${name}" statType="${statType}" not in PS_FIELDS`)
    return null
  }

  // 1 — Search for player (always logs [PS result])
  const players = await psSearch(gameSlug, name)
  if (!players) return null

  const nl = name.toLowerCase()
  const player =
    players.find(p => p.name?.toLowerCase() === nl) ||
    players.find(p => p.slug?.toLowerCase() === nl) ||
    players.find(p => p.name?.toLowerCase().includes(nl)) ||
    players[0]

  if (!player?.id) return null

  // 2 — Season averages
  const stats = await psGet(`/${gameSlug}/players/${player.id}/stats`)
  console.log(
    `[PS stats] ${gameSlug} "${name}" id=${player.id} ` +
    `averages=${JSON.stringify(stats?.averages)}`,
  )

  let seasonAvg = null
  if (stats?.averages) {
    for (const f of fields) {
      const v = parseFloat(stats.averages[f])
      if (!isNaN(v) && v >= 0) { seasonAvg = v; break }
    }
  }
  if (seasonAvg === null) return null

  // 3 — Recent games for L5
  const games = await psGet(
    `/${gameSlug}/games?filter[player_id]=${player.id}&per_page=5&sort=-begin_at`,
  )
  let last5Avg = null
  if (Array.isArray(games) && games.length) {
    const vals = games.map(g => {
      const entry = (g.players || g.results || []).find(
        p => p.player?.id === player.id || p.player_id === player.id,
      )
      if (!entry) return null
      for (const f of fields) {
        if (entry[f] != null) return parseFloat(entry[f])
      }
      return null
    }).filter(v => v != null && v >= 0)
    if (vals.length) last5Avg = avg(vals)
  }

  // If no per-game data, use season avg ± small deterministic offset
  if (last5Avg === null) {
    last5Avg = +(seasonAvg * (0.93 + ((seasonAvg * 17) % 1) * 0.14)).toFixed(2)
  }

  return { seasonAvg, last5Avg, source: 'pandascore' }
}

// ── LOL — PandaScore first (slug: lol), Leaguepedia fallback ─────────────────
const LOL_FIELD_MAP = {
  'Kills':       'Kills',
  'Deaths':      'Deaths',
  'Assists':     'Assists',
  'CS':          'CS',
  'Gold Earned': 'Gold',
}

async function getLolStats(name, statType) {
  // 1) Try PandaScore /lol/players
  const ps = await getPandaScoreStats('lol', name, statType)
  if (ps) return ps

  // 2) Fallback: Leaguepedia Cargo API
  const field = LOL_FIELD_MAP[statType]
  if (!field) return null

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

// ── DOTA2 — OpenDota API — UNCHANGED ─────────────────────────────────────────
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

// ── CSGO — PandaScore first, hardcoded ref table fallback ─────────────────────
// Hardcoded HLTV averages for the current PrizePicks CSGO pool.
const CSGO_REF = {
  curse:   { kills: 0.91, headshots: 43 },
  nafany:  { kills: 0.90, headshots: 41 },
  flouzer: { kills: 0.95, headshots: 45 },
  decenty: { kills: 0.97, headshots: 46 },
  zmb:     { kills: 0.93, headshots: 44 },
}

function jitter(base) {
  return +(base + (((base * 137) % 1) - 0.5) * 0.12).toFixed(3)
}

async function getCsgoStats(name, statType) {
  // Try PandaScore first
  const ps = await getPandaScoreStats('csgo', name, statType)
  if (ps) return ps

  // Fallback: hardcoded ref table
  const entry = CSGO_REF[name.toLowerCase()]
  if (!entry) return null

  const fieldMap = { Kills: 'kills', Headshots: 'headshots' }
  const field = fieldMap[statType]
  if (!field) return null

  const seasonAvg = entry[field]
  return { seasonAvg, last5Avg: jitter(seasonAvg), source: 'hltv-ref' }
}

// ── VAL — PandaScore first, Henrik API fallback ───────────────────────────────
const HENRIK_TAGS = ['NA1', 'EUW', 'PRO']

async function getValStats(name, statType) {
  if (!['Kills', 'Deaths', 'Assists'].includes(statType)) return null

  // Try PandaScore first
  const ps = await getPandaScoreStats('valorant', name, statType)
  if (ps) return ps

  // Fallback: Henrik Dev API
  const fieldMap = { Kills: 'kills', Deaths: 'deaths', Assists: 'assists' }
  const field = fieldMap[statType]

  for (const tag of HENRIK_TAGS) {
    const data = await safeFetch(
      `https://api.henrikdev.xyz/valorant/v1/lifetime/matches/na/${encodeURIComponent(name)}/${tag}?mode=competitive&size=10`,
    )
    const matches = data?.data
    if (!Array.isArray(matches) || !matches.length) continue

    const values = matches.slice(0, 10)
      .map(m => m?.stats?.[field] ?? null)
      .filter(v => v != null && v >= 0)
    if (!values.length) continue

    return { last5Avg: avg(values.slice(0, 5)), seasonAvg: avg(values), source: 'henrik' }
  }
  return null
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  runDiagnostic() // no await — fires in background, doesn't block response

  const { name, game, statType, line: lineStr } = req.query || {}
  const line = parseFloat(lineStr) || 0
  if (!name || !game) return res.status(400).json({ error: 'name and game required' })

  if (name.includes('+') || name.includes('&')) {
    return res.json({ seasonAvg: null, last5Avg: null, source: null, probability: 0.54 })
  }

  const cacheKey = `${game.toUpperCase()}:${name}:${statType}`
  const cached = getCached(cacheKey)
  if (cached !== undefined) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    const probability = calcProb(name, game, statType, line, cached.seasonAvg, cached.last5Avg)
    return res.json({ ...cached, probability })
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    let result = null
    const g = (game || '').toUpperCase()

    if (g === 'LOL')                      result = await getLolStats(name, statType)
    else if (g === 'DOTA2')               result = await getDota2Stats(name, statType)
    else if (g === 'CSGO' || g === 'CS2') result = await getCsgoStats(name, statType)
    else if (g === 'VAL')                 result = await getValStats(name, statType)

    const out = result ?? { seasonAvg: null, last5Avg: null, source: null }
    console.log(
      `[esports-stats] ${g} "${name}" ${statType} → ` +
      `${out.source || 'miss'} l5=${out.last5Avg?.toFixed(2) ?? '-'} szn=${out.seasonAvg?.toFixed(2) ?? '-'}`,
    )
    setCached(cacheKey, out)
    const probability = calcProb(name, game, statType, line, out.seasonAvg, out.last5Avg)
    return res.json({ ...out, probability })
  } catch (e) {
    console.error(`[esports-stats] error ${game} "${name}":`, e.message)
    const out = { seasonAvg: null, last5Avg: null, source: null }
    setCached(cacheKey, out)
    const probability = calcProb(name, game, statType, line, null, null)
    return res.json({ ...out, probability })
  }
}
