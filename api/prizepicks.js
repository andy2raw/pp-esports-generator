// No server-side league filter — pass all props through so client can filter
// by any league (esports + MLB). Log per-league counts for debugging.
const PP_URL = 'https://partner-api.prizepicks.com/projections?per_page=250&single_stat=true'

let cache = null
let cacheTs = 0
const CACHE_TTL = 60_000

export default async function handler(req, res) {
  if (Date.now() - cacheTs < CACHE_TTL && cache) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
    return res.json(cache)
  }

  const upstream = await fetch(PP_URL, {
    headers: { 'User-Agent': 'pp-esports-generator/1.0' },
  })
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `PrizePicks API error: ${upstream.status}` })
  }

  const json = await upstream.json()

  // Build included lookup for logging
  const inc = {}
  for (const item of json.included || []) {
    if (!inc[item.type]) inc[item.type] = {}
    inc[item.type][item.id] = item
  }

  // Log per-league prop counts so we can verify MLB is coming through
  const leagueCounts = {}
  for (const p of json.data || []) {
    const playerRef = p.relationships?.new_player?.data
    const player    = playerRef ? inc?.new_player?.[playerRef.id] : null
    const league    = (
      player?.attributes?.league_name ||
      player?.attributes?.league ||
      p.attributes?.league ||
      'UNKNOWN'
    ).toUpperCase()
    leagueCounts[league] = (leagueCounts[league] || 0) + 1
  }
  console.log('[prizepicks] total props:', (json.data || []).length, 'per league:', JSON.stringify(leagueCounts))

  cache = json
  cacheTs = Date.now()

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
  res.json(json)
}
