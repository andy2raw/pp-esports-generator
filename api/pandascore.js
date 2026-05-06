const PANDASCORE_KEY = process.env.PANDASCORE_KEY || 'QkohrjP_82QcwWoUPQiWrpNPszApddHt-5ZyJlBSEyeLz7-Vpq4'
const BASE = 'https://api.pandascore.co'

const cache = new Map()
const CACHE_TTL = 5 * 60_000

async function psGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${PANDASCORE_KEY}` },
  })
  if (!res.ok) throw new Error(`PandaScore ${res.status}: ${path}`)
  return res.json()
}

function cached(key, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.data)
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data })
}

function gameToSlug(game) {
  const map = { LOL: 'lol', CSGO: 'csgo', CS2: 'csgo', VAL: 'valorant', DOTA2: 'dota2' }
  return map[(game || '').toUpperCase()] || 'lol'
}

export default async function handler(req, res) {
  const { action, name, game, playerId } = req.query || {}

  if (!action) return res.status(400).json({ error: 'action required' })
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    // ── Search player by name ────────────────────────────────────────────────
    if (action === 'search') {
      const slug = gameToSlug(game)
      const data = await cached(`search:${slug}:${name}`, () =>
        psGet(`/${slug}/players?search[name]=${encodeURIComponent(name)}&per_page=5`),
      )
      const match = data.find(p => p.name?.toLowerCase() === name?.toLowerCase()) || data[0] || null
      return res.json(match)
    }

    // ── Season averages ─────────────────────────────────────────────────────
    if (action === 'stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const data = await cached(`stats:${slug}:${playerId}`, () =>
        psGet(`/${slug}/players/${playerId}/stats`),
      )
      return res.json(data)
    }

    // ── Recent per-game stats (last 5 games with player data) ────────────────
    // Uses the /games endpoint which returns game objects containing each
    // player's in-game stats (kills, deaths, assists, etc.).
    if (action === 'recent_stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const data = await cached(`recent:${slug}:${playerId}`, () =>
        psGet(`/${slug}/games?filter[player_id]=${playerId}&per_page=5&sort=-begin_at`),
      )
      return res.json(Array.isArray(data) ? data : [])
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
