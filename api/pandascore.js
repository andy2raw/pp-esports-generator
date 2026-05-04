const PANDASCORE_KEY = process.env.PANDASCORE_KEY || 'QkohrjP_82QcwWoUPQiWrpNPszApddHt-5ZyJlBSEyeLz7-Vpq4'
const BASE = 'https://api.pandascore.co'

const playerCache = new Map()
const statsCache = new Map()
const CACHE_TTL = 5 * 60_000

async function psGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${PANDASCORE_KEY}` },
  })
  if (!res.ok) throw new Error(`PandaScore ${res.status}: ${path}`)
  return res.json()
}

export default async function handler(req, res) {
  const { action, name, game } = req.query || {}

  if (!action) return res.status(400).json({ error: 'action required' })

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    if (action === 'search') {
      const ckey = `${game}:${name}`
      if (playerCache.has(ckey) && Date.now() - playerCache.get(ckey).ts < CACHE_TTL) {
        return res.json(playerCache.get(ckey).data)
      }

      const gameSlug = gameToSlug(game)
      const data = await psGet(`/${gameSlug}/players?search[name]=${encodeURIComponent(name)}&per_page=5`)
      const match = data.find(p => p.name?.toLowerCase() === name.toLowerCase()) || data[0] || null
      playerCache.set(ckey, { data: match, ts: Date.now() })
      return res.json(match)
    }

    if (action === 'stats') {
      const { playerId, game: g } = req.query
      if (!playerId) return res.status(400).json({ error: 'playerId required' })

      const ckey = `stats:${g}:${playerId}`
      if (statsCache.has(ckey) && Date.now() - statsCache.get(ckey).ts < CACHE_TTL) {
        return res.json(statsCache.get(ckey).data)
      }

      const gameSlug = gameToSlug(g)
      const data = await psGet(`/${gameSlug}/players/${playerId}/stats`)
      statsCache.set(ckey, { data, ts: Date.now() })
      return res.json(data)
    }

    if (action === 'recent') {
      const { playerId, game: g } = req.query
      if (!playerId) return res.status(400).json({ error: 'playerId required' })

      const ckey = `recent:${g}:${playerId}`
      if (statsCache.has(ckey) && Date.now() - statsCache.get(ckey).ts < CACHE_TTL) {
        return res.json(statsCache.get(ckey).data)
      }

      const gameSlug = gameToSlug(g)
      const data = await psGet(`/${gameSlug}/players/${playerId}/matches?per_page=10&sort=-scheduled_at`)
      statsCache.set(ckey, { data, ts: Date.now() })
      return res.json(data)
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

function gameToSlug(game) {
  const map = { LOL: 'lol', CSGO: 'csgo', CS2: 'csgo', VAL: 'valorant', DOTA2: 'dota2' }
  return map[(game || '').toUpperCase()] || 'lol'
}
