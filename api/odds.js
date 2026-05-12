// Fetches MLB player prop lines from The Odds API (DraftKings + FanDuel).
// Returns { lines: { "normname::StatType": { dk, fd } }, updatedAt }
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=3600')

  if (Date.now() - cache.ts < CACHE_TTL_MS && cache.data) {
    return res.json(cache.data)
  }

  const apiKey = process.env.VITE_ODDS_API_KEY
  if (!apiKey) {
    console.warn('[odds] VITE_ODDS_API_KEY not set')
    return res.json({ lines: {}, updatedAt: new Date().toISOString() })
  }

  try {
    // 1. Today's MLB events (±3h past to +24h future)
    const now = Date.now()
    const from = new Date(now - 3 * 60 * 60 * 1000).toISOString()
    const to   = new Date(now + 24 * 60 * 60 * 1000).toISOString()
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events` +
      `?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`

    const evRes = await fetch(eventsUrl)
    if (!evRes.ok) throw new Error(`Events fetch failed: ${evRes.status}`)
    const events = await evRes.json()

    console.log(`[odds] ${events.length} MLB events today`)

    // 2. Fetch player props for each event (cap at 10 to limit quota usage)
    const lines = {}

    const fetches = events.slice(0, 10).map(async ev => {
      const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${ev.id}/odds` +
        `?apiKey=${apiKey}&regions=us&markets=${MLB_MARKETS}&oddsFormat=american`
      const r = await fetch(url)
      if (!r.ok) {
        console.warn(`[odds] event ${ev.id} props fetch failed: ${r.status}`)
        return
      }
      const data = await r.json()

      for (const bm of (data.bookmakers || [])) {
        const bmKey = bm.key === 'draftkings' ? 'dk' : bm.key === 'fanduel' ? 'fd' : null
        if (!bmKey) continue

        for (const market of (bm.markets || [])) {
          const statType = MARKET_TO_STAT[market.key]
          if (!statType) continue

          for (const outcome of (market.outcomes || [])) {
            if (outcome.name !== 'Over') continue  // only compare OVER lines
            const key = `${normName(outcome.description)}::${statType}`
            if (!lines[key]) lines[key] = {}
            // Keep the lower (tighter) line from each book if we see duplicates
            if (lines[key][bmKey] == null || outcome.point < lines[key][bmKey]) {
              lines[key][bmKey] = outcome.point
            }
          }
        }
      }
    })

    await Promise.all(fetches)

    const entryCount = Object.keys(lines).length
    console.log(`[odds] built ${entryCount} player line entries`)

    const result = { lines, updatedAt: new Date().toISOString() }
    cache = { ts: Date.now(), data: result }
    return res.json(result)
  } catch (e) {
    console.error('[odds] error:', e.message)
    if (cache.data) return res.json(cache.data)
    return res.json({ lines: {}, updatedAt: new Date().toISOString() })
  }
}
