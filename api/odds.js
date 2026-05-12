// Fetches MLB player prop lines from The Odds API (DraftKings + FanDuel).
// Returns { lines: { "normname::StatType": { dk, fd } }, updatedAt, debug }
// Cached server-side for 60 minutes to preserve API quota.

const CACHE_TTL_MS = 60 * 60 * 1000

let cache = { ts: 0, data: null }

const MLB_MARKETS = [
  'batter_hits',
  'batter_home_runs',
  'batter_rbis',
  'batter_runs_scored',
  'batter_total_bases',
  'batter_walks',
  'batter_strikeouts',
  'batter_stolen_bases',
  'pitcher_strikeouts',
  'pitcher_hits_allowed',
  'pitcher_earned_runs',
].join(',')

// Odds API market key → PrizePicks stat type label
const MARKET_TO_STAT = {
  batter_hits:          'Hits',
  batter_home_runs:     'Home Runs',
  batter_rbis:          'RBIs',
  batter_runs_scored:   'Runs Scored',
  batter_total_bases:   'Total Bases',
  batter_walks:         'Walks',
  batter_strikeouts:    'Strikeouts',
  batter_stolen_bases:  'Stolen Bases',
  pitcher_strikeouts:   'Pitcher Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_earned_runs:  'Earned Runs Allowed',
}

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

async function safeFetch(url, label) {
  const res = await fetch(url)
  const remaining = res.headers.get('x-requests-remaining')
  const used      = res.headers.get('x-requests-used')
  if (remaining || used) {
    console.log(`[odds] ${label} → status ${res.status} | quota used=${used} remaining=${remaining}`)
  } else {
    console.log(`[odds] ${label} → status ${res.status}`)
  }
  return res
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=3600')

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
    const now  = Date.now()
    const from = new Date(now - 3 * 60 * 60 * 1000).toISOString()
    const to   = new Date(now + 24 * 60 * 60 * 1000).toISOString()
    const evRes = await safeFetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`,
      'mlb-events',
    )
    if (!evRes.ok) throw new Error(`Events fetch failed: ${evRes.status}`)
    const eventsRaw = await evRes.json()

    if (!Array.isArray(eventsRaw)) {
      console.error('[odds] events response is not an array:', JSON.stringify(eventsRaw).slice(0, 200))
      return res.json({ lines: {}, updatedAt: new Date().toISOString(), debug: 'events_not_array' })
    }

    console.log(`[odds] ${eventsRaw.length} MLB events in window`)
    debug.push(`events:${eventsRaw.length}`)

    if (eventsRaw.length === 0) {
      const result = { lines: {}, updatedAt: new Date().toISOString(), debug: 'no_events_today' }
      cache = { ts: Date.now(), data: result }
      return res.json(result)
    }

    // ── Step 3: Player props per event ───────────────────────────────────────
    const lines = {}
    let totalOutcomes = 0

    const fetches = eventsRaw.slice(0, 10).map(async (ev, idx) => {
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
