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

function isCached(key) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : undefined
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }) }

function gameToSlug(game) {
  const map = { LOL: 'lol', CSGO: 'csgo', CS2: 'csgo', VAL: 'valorant', DOTA2: 'dota2' }
  return map[(game || '').toUpperCase()] || 'lol'
}

// Build ordered list of name variants to try.
// For "DDahyuk":
//   DDahyuk, ddahyuk, Dahyuk (camelCase split), DD, ahyuk (UC prefix/suffix)
function buildAttempts(name) {
  if (!name) return []
  const seen = new Set()
  const add = s => { const t = s?.trim(); if (t && t.length >= 2) seen.add(t) }

  add(name)                                          // DDahyuk
  add(name.toLowerCase())                            // ddahyuk

  // Strip non-alphanumeric (dots, underscores, etc.)
  const clean = name.replace(/[^a-zA-Z0-9]/g, '')
  add(clean)
  add(clean.toLowerCase())

  // Split on whitespace / dots / underscores / hyphens
  name.split(/[\s._\-]+/).forEach(w => add(w))

  // CamelCase split: before each Cap+lower boundary
  // "DDahyuk" → split at position 1 → ["D", "Dahyuk"]
  name.split(/(?=[A-Z][a-z])/).forEach(p => add(p))

  // Leading uppercase run: "DDahyuk" → prefix "DD", suffix "ahyuk"
  const ucRun = name.match(/^([A-Z]{2,})([a-z].+)$/)
  if (ucRun) {
    add(ucRun[1])           // "DD"
    add(ucRun[2])           // "ahyuk"
  }

  // Last segment after any separator (catches "Team.PlayerName" → "PlayerName")
  const segments = name.split(/[._\-\s]/)
  if (segments.length > 1) add(segments[segments.length - 1])

  return [...seen].filter(s => s.length >= 2)
}

async function searchPlayer(gameSlug, originalName) {
  const cacheKey = `search:${gameSlug}:${originalName.toLowerCase()}`
  const cached = isCached(cacheKey)
  if (cached !== undefined) return cached

  const attempts = buildAttempts(originalName)
  console.log(`[PS search] "${originalName}" (${gameSlug}) — trying ${attempts.length} variants: ${JSON.stringify(attempts)}`)

  for (const attempt of attempts) {
    // ── name search ──────────────────────────────────────────────────────────
    const byName = await psGet(
      `/${gameSlug}/players?search[name]=${encodeURIComponent(attempt)}&per_page=10`,
    ).catch(() => [])
    console.log(`[PS attempt] search[name]="${attempt}" → ${byName.length} result(s)${byName.length ? ': ' + byName.map(p => p.name + '(' + p.id + ')').join(', ') : ''}`)

    if (byName.length) {
      const lower = originalName.toLowerCase()
      const match =
        byName.find(p => p.name?.toLowerCase() === lower) ||
        byName.find(p => p.slug?.toLowerCase() === lower) ||
        byName.find(p => p.slug?.toLowerCase() === attempt.toLowerCase()) ||
        byName.find(p => p.name?.toLowerCase() === attempt.toLowerCase()) ||
        byName[0]
      console.log(`[PS match] via name search "${attempt}" → ${match.name}(id=${match.id}) slug=${match.slug}`)
      setCache(cacheKey, match)
      return match
    }

    // ── slug filter ──────────────────────────────────────────────────────────
    const slugAttempt = attempt.toLowerCase().replace(/[^a-z0-9]/g, '')
    const bySlug = await psGet(
      `/${gameSlug}/players?filter[slug]=${encodeURIComponent(slugAttempt)}&per_page=5`,
    ).catch(() => [])
    console.log(`[PS attempt] filter[slug]="${slugAttempt}" → ${bySlug.length} result(s)${bySlug.length ? ': ' + bySlug.map(p => p.name + '(' + p.id + ')').join(', ') : ''}`)

    if (bySlug.length) {
      const match = bySlug[0]
      console.log(`[PS match] via slug filter "${slugAttempt}" → ${match.name}(id=${match.id})`)
      setCache(cacheKey, match)
      return match
    }
  }

  console.log(`[PS search] "${originalName}" (${gameSlug}) — NO MATCH after all attempts`)
  setCache(cacheKey, null)
  return null
}

export default async function handler(req, res) {
  const { action, name, game, playerId } = req.query || {}

  if (!action) return res.status(400).json({ error: 'action required' })
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  try {
    // ── Search ───────────────────────────────────────────────────────────────
    if (action === 'search') {
      const match = await searchPlayer(gameToSlug(game), name || '')
      return res.json(match)
    }

    // ── Season averages ──────────────────────────────────────────────────────
    if (action === 'stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const cacheKey = `stats:${slug}:${playerId}`
      const cached = isCached(cacheKey)
      if (cached !== undefined) return res.json(cached)

      const data = await psGet(`/${slug}/players/${playerId}/stats`)
      console.log(`[PS stats] id=${playerId} keys=${JSON.stringify(Object.keys(data || {}))} averages=${JSON.stringify(data?.averages || null)}`)
      setCache(cacheKey, data)
      return res.json(data)
    }

    // ── Recent per-game stats ────────────────────────────────────────────────
    if (action === 'recent_stats') {
      if (!playerId) return res.status(400).json({ error: 'playerId required' })
      const slug = gameToSlug(game)
      const cacheKey = `recent:${slug}:${playerId}`
      const cached = isCached(cacheKey)
      if (cached !== undefined) return res.json(cached)

      const data = await psGet(
        `/${slug}/games?filter[player_id]=${playerId}&per_page=5&sort=-begin_at`,
      ).catch(() => [])
      const games = Array.isArray(data) ? data : []
      console.log(`[PS recent] id=${playerId} games=${games.length} sample_players=${JSON.stringify(games[0]?.players?.slice(0, 2)?.map(p => ({ id: p.player?.id, name: p.player?.name, kills: p.kills })) ?? [])}`)
      setCache(cacheKey, games)
      return res.json(games)
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (e) {
    console.error(`[PS error] action=${action} name=${name}`, e.message)
    return res.status(500).json({ error: e.message })
  }
}
