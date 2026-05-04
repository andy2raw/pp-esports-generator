const ESPORTS_LEAGUES = new Set(['LOL', 'CSGO', 'VAL', 'DOTA2', 'CS2'])
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

  const inc = {}
  for (const item of json.included || []) {
    if (!inc[item.type]) inc[item.type] = {}
    inc[item.type][item.id] = item
  }

  const filtered = (json.data || []).filter(p => {
    const playerRef = p.relationships?.new_player?.data
    const player = playerRef ? inc?.new_player?.[playerRef.id] : null
    const league = (
      player?.attributes?.league_name ||
      player?.attributes?.league ||
      p.attributes?.league ||
      ''
    ).toUpperCase()
    return ESPORTS_LEAGUES.has(league)
  })

  const result = { ...json, data: filtered }
  cache = result
  cacheTs = Date.now()

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30')
  res.json(result)
}
