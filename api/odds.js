// Fetches MLB player prop lines from The Odds API (DraftKings + FanDuel).
// Returns { lines: { "normname::StatType": { dk, fd } }, updatedAt, debug }
// Cached server-side for 60 minutes to preserve API quota.

const CACHE_TTL_MS = 60 * 60 * 1000

let cache = { ts: 0, data: null }

// Validated market keys from The Odds API for baseball_mlb player props.
// batter_stolen_bases is NOT a valid key and causes 422 — removed.
const MLB_MARKETS = [
  'batter_hits',
  'batter_total_bases',
  'batter_rbis',
  'batter_runs_scored',
  'batter_hits_runs_rbis',
  'batter_singles',
  'batter_doubles',
  'batter_home_runs',
  'batter_strikeouts',
  'batter_walks',
  'pitcher_strikeouts',
  'pitcher_hits_allowed',
  'pitcher_walks',
  'pitcher_earned_runs',
  'pitcher_outs',
].join(',')

// Odds API market key → PrizePicks stat type label
const MARKET_TO_STAT = {
  batter_hits:          'Hits',
  batter_total_bases:   'Total Bases',
  batter_rbis:          'RBIs',
  batter_runs_scored:   'Runs Scored',
  batter_hits_runs_rbis:'Hits+Runs+RBIs',
  batter_singles:       'Singles',
  batter_doubles:       'Doubles',
  batter_home_runs:     'Home Runs',
  batter_strikeouts:    'Strikeouts',
  batter_walks:         'Walks',
  pitcher_strikeouts:   'Pitcher Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_walks:        'Pitcher Walks',
  pitcher_earned_runs:  'Earned Runs Allowed',
  pitcher_outs:         'Pitching Outs',
}

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

async function safeFetch(url, label) {
  // Log full URL (mask key value but keep params visible for debugging)
  const displayUrl = url.replace(/apiKey=[^&]+/, 'apiKey=***')
  console.log(`[odds] ${label} → GET ${displayUrl}`)
  const res = await fetch(url)
  const remaining = res.headers.get('x-requests-remaining')
  const used      = res.headers.get('x-requests-used')
  console.log(`[odds] ${label} → status ${res.status} | quota used=${used ?? '?'} remaining=${remaining ?? '?'}`)
  return res
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=3600')

  // Invalidate cache if it captured a bad state (missing key or empty lines).
  if (cache.data) {
    const stale = cache.data.debug?.includes('missing') ||
                  Object.keys(cache.data.lines ?? {}).length === 0
    if (stale) {
      console.log('[odds] invalidating stale/empty cache, debug was:', cache.data.debug)
      cache = { ts: 0, data: null }
    }
  }

  // Serve cache while still valid
  if (Date.now() - cache.ts < CACHE_TTL_MS && cache.data) {
    console.log('[odds] serving cached data, entries:', Object.keys(cache.data.lines).length)
    return res.json(cache.data)
  }

  const apiKey = process.env.VITE_ODDS_API_KEY
  if (!apiKey) {
    console.error('[odds] VITE_ODDS_API_KEY is not set in environment')
    return res.json({ lines: {}, updatedAt: new Date().toISOString(), debug: 'VITE_ODDS_API_KEY missing' })
  }
  console.log(`[odds] using key …${apiKey.slice(-4)}`)

  const debug = []

  try {
    // ── Step 1: Validate key via sports list ─────────────────────────────────
    const sportsRes = await safeFetch(
      `https://api.the-odds-api.com/v4/sports?apiKey=${apiKey}`,
      'sports-list',
    )
    if (!sportsRes.ok) {
      const text = await sportsRes.text()
      console.error('[odds] key validation failed:', sportsRes.status, text.slice(0, 200))
      return res.json({ lines: {}, updatedAt: new Date().toISOString(), debug: `key_invalid:${sportsRes.status}` })
    }
    const sports = await sportsRes.json()
    const mlbSport = Array.isArray(sports) && sports.find(s => s.key === 'baseball_mlb')
    console.log(`[odds] sports list OK — ${Array.isArray(sports) ? sports.length : '?'} sports, baseball_mlb active=${mlbSport?.active ?? 'not found'}`)
    debug.push(`sports:${Array.isArray(sports) ? sports.length : 'err'}`)

    // ── Step 2: Today's MLB events ───────────────────────────────────────────
    // Only apiKey + dateFormat on the events endpoint — commenceTime* params
    // were causing 422s; filter the window client-side instead.
    const evRes = await safeFetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}&dateFormat=iso`,
      'mlb-events',
    )
    if (!evRes.ok) {
      const body = await evRes.text()
      console.error('[odds] events fetch failed:', evRes.status, body.slice(0, 300))
      throw new Error(`Events fetch failed: ${evRes.status}`)
    }
    const eventsRaw = await evRes.json()

    if (!Array.isArray(eventsRaw)) {
      console.error('[odds] events response is not an array:', JSON.stringify(eventsRaw).slice(0, 200))
      return res.json({ lines: {}, updatedAt: new Date().toISOString(), debug: 'events_not_array' })
    }

    // Filter to games within ±3h past → +24h future client-side
    const now  = Date.now()
    const from = now - 3 * 60 * 60 * 1000
    const to   = now + 24 * 60 * 60 * 1000
    const events = eventsRaw.filter(ev => {
      const t = ev.commence_time ? new Date(ev.commence_time).getTime() : 0
      return t >= from && t <= to
    })

    console.log(`[odds] ${eventsRaw.length} total MLB events, ${events.length} in today's window`)
    debug.push(`events:${events.length}`)

    if (events.length === 0) {
      const result = { lines: {}, updatedAt: new Date().toISOString(), debug: 'no_events_today' }
      cache = { ts: Date.now(), data: result }
      return res.json(result)
    }

    // ── Step 3: Player props per event ───────────────────────────────────────
    const lines = {}
    let totalOutcomes = 0

    const fetches = events.slice(0, 10).map(async (ev, idx) => {
      const propsRes = await safeFetch(
        `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${ev.id}/odds` +
          `?apiKey=${apiKey}&regions=us&markets=${MLB_MARKETS}&oddsFormat=american`,
        `event[${idx}] ${ev.home_team ?? ev.id}`,
      )
      if (!propsRes.ok) {
        console.warn(`[odds] event ${ev.id} props ${propsRes.status}`)
        return
      }
      const data = await propsRes.json()
      const bookmakers = data.bookmakers || []

      // Log first event raw bookmakers for diagnosis
      if (idx === 0) {
        console.log(`[odds] event[0] bookmakers: ${bookmakers.map(b => b.key).join(', ') || 'none'}`)
        if (bookmakers.length > 0) {
          const markets = bookmakers[0].markets || []
          console.log(`[odds] event[0] ${bookmakers[0].key} markets: ${markets.map(m => m.key).join(', ') || 'none'}`)
        }
      }

      for (const bm of bookmakers) {
        const bmKey = bm.key === 'draftkings' ? 'dk' : bm.key === 'fanduel' ? 'fd' : null
        if (!bmKey) continue

        for (const market of (bm.markets || [])) {
          const statType = MARKET_TO_STAT[market.key]
          if (!statType) continue

          for (const outcome of (market.outcomes || [])) {
            // Case-insensitive 'over' check
            if ((outcome.name || '').toLowerCase() !== 'over') continue
            if (!outcome.description || outcome.point == null) continue
            const key = `${normName(outcome.description)}::${statType}`
            if (!lines[key]) lines[key] = {}
            if (lines[key][bmKey] == null || outcome.point < lines[key][bmKey]) {
              lines[key][bmKey] = outcome.point
            }
            totalOutcomes++
          }
        }
      }
    })

    await Promise.all(fetches)

    const entryCount = Object.keys(lines).length
    console.log(`[odds] done — ${entryCount} player entries, ${totalOutcomes} total outcomes`)
    debug.push(`entries:${entryCount}`, `outcomes:${totalOutcomes}`)

    // Sample first 3 entries for visibility
    const sample = Object.entries(lines).slice(0, 3).map(([k, v]) => `${k}→${JSON.stringify(v)}`)
    if (sample.length) console.log('[odds] sample entries:', sample.join(' | '))

    const result = { lines, updatedAt: new Date().toISOString(), debug: debug.join(',') }
    cache = { ts: Date.now(), data: result }
    return res.json(result)
  } catch (e) {
    console.error('[odds] unhandled error:', e.message)
    if (cache.data) return res.json(cache.data)
    return res.json({ lines: {}, updatedAt: new Date().toISOString(), debug: `error:${e.message}` })
  }
}
