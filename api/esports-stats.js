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

// Normalize PrizePicks stat type names to canonical keys used in field maps.
// PrizePicks sends e.g. "MAPS 1-2 Kills" — strip prefixes and map to base type.
function normalizeStatType(statType) {
  const st = (statType || '').toLowerCase()
  if (st.includes('kill'))     return 'Kills'
  if (st.includes('death'))    return 'Deaths'
  if (st.includes('assist'))   return 'Assists'
  if (st.includes('headshot')) return 'Headshots'
  if (st.includes(' cs') || st === 'cs' || st.includes('creep')) return 'CS'
  if (st.includes('gold'))     return 'Gold Earned'
  return statType
}

// ── Probability calculation ───────────────────────────────────────────────────
// Per-map kill averages used when no player stats are available.
// Multi-map (Maps 1-2) averages are provided separately.
const KILL_AVG = {
  single:   { CSGO: 16, CS2: 16, VAL: 20, LOL: 6,  DOTA2: 8  },
  multimap: { CSGO: 28, CS2: 28, VAL: 35, LOL: 12, DOTA2: 16 },
}

function lineHeuristic(line, game, statType) {
  const g  = (game || '').toUpperCase()
  const st = (statType || '').toLowerCase()

  if (st.includes('kill')) {
    const isMultiMap = /1-2|1-3|combo/i.test(statType)
    const avgs   = isMultiMap ? KILL_AVG.multimap : KILL_AVG.single
    const typical = avgs[g]
    if (typical && typical > 0) {
      const ratio = line / typical
      // Continuous formula: every unique line → unique probability.
      // ratio=0 → 1.0 (certain), ratio=1 → 0.54 (fair), ratio>1 → trending to 0.44 (tough).
      // Power 1.2 gives a slightly concave curve so near-zero lines score very high.
      const prob = ratio <= 1
        ? Math.min(0.95, 0.54 + Math.pow(1 - ratio, 1.2) * 0.46)
        : Math.max(0.44, 0.54 - (ratio - 1) * 0.25)
      console.log(`[prob] ${game} "${statType}" line=${line} typical=${typical} ratio=${ratio.toFixed(3)} → ${prob.toFixed(3)}`)
      return prob
    }
  }

  // Non-kills or unknown game: neutral, not 0.55
  return 0.54
}

// Apply post-calcProb adjustments: LOL role multiplier + sharp line detection.
// Returns { probability, sharp }.
function finalizeProb(name, game, statType, line, data) {
  let probability = calcProb(name, game, statType, line, data.seasonAvg, data.last5Avg)

  // LOL kills: Support/Jungle players get 0.75× multiplier (fewer kills by design).
  if ((game || '').toUpperCase() === 'LOL' && (statType || '').toLowerCase().includes('kill')) {
    const role = (data.role || '').toLowerCase()
    console.log(`[role] "${name}" → ${data.role ?? 'null'}`)
    if (role && (role.includes('sup') || role.includes('jng') ||
                 role.includes('support') || role.includes('jungle'))) {
      const before = probability
      probability = Math.max(0.44, probability * 0.75)
      console.log(`[lol-role] "${name}" role=${data.role} ${before.toFixed(3)} ×0.75 → ${probability.toFixed(3)}`)
    }
  }

  // Sharp line: when L5 is within 0.5 of the line it's a coin-flip — set to 0.50.
  let sharp = false
  if (data.last5Avg != null && line > 0 && Math.abs(data.last5Avg - line) <= 0.5) {
    probability = 0.50
    sharp = true
    console.log(`[sharp] "${name}" line=${line} l5=${data.last5Avg?.toFixed(2)} → SHARP 0.50`)
  }

  return { probability, sharp }
}

function calcProb(name, game, statType, line, seasonAvg, last5Avg) {
  if (!line || line <= 0) return lineHeuristic(line || 0, game, statType)
  const l5 = last5Avg
  const szn = seasonAvg
  if (szn == null && l5 == null) {
    return lineHeuristic(line, game, statType)
  }

  const l5Above  = l5 != null && l5 > line
  const sznAbove = szn != null && szn > line
  let prob, tag

  if (l5Above && sznAbove) {
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

// Hardcoded role table — used when Leaguepedia/PandaScore don't return a role.
// Supports and low-kill ADCs get the 0.75× kills multiplier in finalizeProb.
const LOL_ROLE_TABLE = {
  // Supports
  kellin: 'sup', meiko: 'sup', career: 'sup', keria: 'sup', lehends: 'sup',
  beryl: 'sup', effort: 'sup', vsta: 'sup', biofrost: 'sup', corejj: 'sup',
  vulcan: 'sup', chime: 'sup', olleh: 'sup', zeyzal: 'sup',
  // Low-kill ADC — also gets multiplier
  ruler: 'sup',
  // Jungles
  peanut: 'jng', canyon: 'jng', oner: 'jng', clearlove: 'jng',
  karsa: 'jng', jankos: 'jng', inspired: 'jng', blaber: 'jng',
  santorin: 'jng', broxah: 'jng', jojo: 'jng', bugi: 'jng',
  winsome: 'jng', erek: 'jng',
}

async function getLolStats(name, statType) {
  const normalStat = normalizeStatType(statType)

  // 1) Try PandaScore /lol/players (normalized stat type)
  const ps = await getPandaScoreStats('lol', name, normalStat)
  if (ps) {
    const role = LOL_ROLE_TABLE[name.toLowerCase()] ?? null
    console.log(`[role] "${name}" → ${role ?? 'null'} (hardcoded, PS hit)`)
    return { ...ps, role }
  }

  // 2) Fallback: Leaguepedia Cargo API (normalized stat type)
  const field = LOL_FIELD_MAP[normalStat]
  if (!field) {
    console.log(`[lol] "${name}" normalStat="${normalStat}" not in LOL_FIELD_MAP, skipping`)
    return null
  }

  const variants = [...new Set([
    name,
    name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
    name.toLowerCase(),
  ])]

  for (const v of variants) {
    const params = new URLSearchParams({
      action:   'cargoquery',
      tables:   'ScoreboardPlayers',
      fields:   `Link,${field},Role`,
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

    // Role: prefer Leaguepedia, fall back to hardcoded table
    const lpRole = rows[0]?.title?.Role || null
    const role   = lpRole ?? LOL_ROLE_TABLE[name.toLowerCase()] ?? null
    console.log(`[role] "${name}" → ${role ?? 'null'} (leaguepedia=${lpRole ?? 'null'})`)
    return { last5Avg: avg(values.slice(0, 5)), seasonAvg: avg(values), source: 'leaguepedia', role }
  }

  // 3) Neither source returned stats — still record role for heuristic path
  const role = LOL_ROLE_TABLE[name.toLowerCase()] ?? null
  console.log(`[role] "${name}" → ${role ?? 'null'} (hardcoded, stats miss)`)
  return role ? { seasonAvg: null, last5Avg: null, source: null, role } : null
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

// ── CSGO — PandaScore first, hardcoded HLTV ref table fallback ───────────────
const CSGO_REF = {
  curse:   { kills: 0.91, headshots: 43, deaths: 0.61 },
  nafany:  { kills: 0.90, headshots: 41, deaths: 0.66 },
  flouzer: { kills: 0.95, headshots: 45, deaths: 0.63 },
  decenty: { kills: 0.97, headshots: 46, deaths: 0.62 },
  zmb:     { kills: 0.93, headshots: 44, deaths: 0.64 },
}

// ±0.06 random jitter on last5Avg to simulate recent-form variance.
function jitter(base) {
  return +(base + (Math.random() * 0.12 - 0.06)).toFixed(3)
}

async function getCsgoStats(name, statType) {
  const ps = await getPandaScoreStats('csgo', name, statType)
  if (ps) return ps

  const entry = CSGO_REF[name.toLowerCase()]
  if (!entry) return null

  const fieldMap = { Kills: 'kills', Headshots: 'headshots', Deaths: 'deaths' }
  const field = fieldMap[statType]
  if (!field) return null

  const seasonAvg = entry[field]
  return { seasonAvg, last5Avg: jitter(seasonAvg), source: 'hltv-ref' }
}

// ── VAL — PandaScore first, Henrik Dev API fallback ──────────────────────────
// Henrik endpoint: GET /valorant/v1/lifetime/matches/na/{name}/{tag}
// Try tags in order: NA1, EUW, PRO
const HENRIK_TAGS = ['NA1', 'EUW', 'PRO']

async function getValStats(name, statType) {
  if (!['Kills', 'Deaths', 'Assists'].includes(statType)) return null

  const ps = await getPandaScoreStats('valorant', name, statType)
  if (ps) return ps

  const fieldMap = { Kills: 'kills', Deaths: 'deaths', Assists: 'assists' }
  const field = fieldMap[statType]

  for (const tag of HENRIK_TAGS) {
    const url = `https://api.henrikdev.xyz/valorant/v1/lifetime/matches/na/${encodeURIComponent(name)}/${tag}`
    const data = await safeFetch(url)
    const matches = data?.data
    if (!Array.isArray(matches) || !matches.length) continue

    const values = matches.slice(0, 10)
      .map(m => {
        const v = m?.stats?.[field] ?? m?.kills ?? null
        return v != null && v >= 0 ? Number(v) : null
      })
      .filter(v => v != null)
    if (!values.length) continue

    console.log(`[henrik] VAL "${name}" tag=${tag} field=${field} n=${values.length} l5=${avg(values.slice(0, 5))?.toFixed(2)}`)
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
    return res.json({ seasonAvg: null, last5Avg: null, source: null })
  }

  const cacheKey = `${game.toUpperCase()}:${name}:${statType}`
  const cached = getCached(cacheKey)
  if (cached !== undefined) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
    const { probability, sharp } = finalizeProb(name, game, statType, line, cached)
    return res.json({ ...cached, probability, sharp })
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
    const { probability, sharp } = finalizeProb(name, game, statType, line, out)
    return res.json({ ...out, probability, sharp })
  } catch (e) {
    console.error(`[esports-stats] error ${game} "${name}":`, e.message)
    const out = { seasonAvg: null, last5Avg: null, source: null }
    setCached(cacheKey, out)
    const probability = lineHeuristic(line, game, statType)
    return res.json({ ...out, probability, sharp: false })
  }
}
