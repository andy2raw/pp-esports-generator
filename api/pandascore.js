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
    // ── Search player by name or slug ────────────────────────────────────────
    if (action === 'search') {
      const slug = gameToSlug(game)
      const lower = (name || '').toLowerCase()

      const data = await cached(`search:${slug}:${lower}`, async () => {
        // Primary: search by display name
        const byName = await psGet(
          `/${slug}/players?search[name]=${encodeURIComponent(name)}&per_page=10`,
        ).catch(() => [])

        if (byName.length) return byName

        // Fallback: filter by slug (PandaScore slug is usually IGN lowercased)
        const bySlug = await psGet(
          `/${slug}/players?filter[slug]=${encodeURIComponent(lower)}&per_page=5`,
        ).catch(() => [])

        return bySlug
      })

      const match =
        data.find(p => p.name?.toLowerCase() === lower) ||
        data.find(p => p.slug?.toLowerCase() === lower) ||
        data.find(p => p.name?.toLowerCase().includes(lower)) ||
        data[0] || null

      // Temporary debug log — visible in Vercel function logs
      console.log(`[PS search] slug=${slug} name=${name} results=${data.length} matched=${match?.name ?? 'null'}(id=${match?.id ?? '-'})`)

      return res.json(match)
    }

    // ── Season averages ──────────────────────────────────────────────────────
    if (action === 'stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const data = await cached(`stats:${slug}:${playerId}`, () =>
        psGet(`/${slug}/players/${playerId}/stats`),
      )

      // Temporary debug log
      console.log(`[PS stats] id=${playerId} topKeys=${JSON.stringify(Object.keys(data || {}))} averages=${JSON.stringify(data?.averages || data?.per_game || null)}`)

      return res.json(data)
    }

    // ── Recent per-game stats ────────────────────────────────────────────────
    // /games?filter[player_id]= returns game objects each containing a
    // players[] array with that player's in-game stats (kills, deaths, etc.)
    if (action === 'recent_stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const data = await cached(`recent:${slug}:${playerId}`, () =>
        psGet(`/${slug}/games?filter[player_id]=${playerId}&per_page=5&sort=-begin_at`),
      )

      const games = Array.isArray(data) ? data : []
      console.log(`[PS recent] id=${playerId} games=${games.length} first_player_count=${games[0]?.players?.length ?? 0}`)

      return res.json(games)
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e) {
    console.error(`[PS error] action=${action}`, e.message)
    return res.status(500).json({ error: e.message })
  }
}
