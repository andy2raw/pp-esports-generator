import { useState, useEffect, useRef, useCallback } from 'react'

const STAT_MAP = {
  LOL: {
    'Kills':       ['kills'],
    'Deaths':      ['deaths'],
    'Assists':     ['assists'],
    'CS':          ['minions_killed', 'neutral_minions_killed'],
    'Gold Earned': ['gold_earned'],
    'KDA':         null,
  },
  CSGO: {
    'Kills':       ['kills'],
    'Deaths':      ['deaths'],
    'Assists':     ['assists'],
    'Headshots':   ['headshots'],
    'Rating':      null,
  },
  VAL: {
    'Kills':       ['kills'],
    'Deaths':      ['deaths'],
    'Assists':     ['assists'],
    'Headshots':   ['headshots'],
  },
  DOTA2: {
    'Kills':       ['kills'],
    'Deaths':      ['deaths'],
    'Assists':     ['assists'],
    'Last Hits':   ['last_hits'],
    'Gold Per Min':['gold_per_min'],
  },
}

function sumFields(obj, fields) {
  if (!obj || !fields) return null
  let total = 0
  for (const f of fields) {
    const v = obj[f]
    if (v == null) return null
    total += parseFloat(v) || 0
  }
  return total
}

// PandaScore stats endpoint returns different shapes by game.
// Try several known key paths before giving up.
function extractSeasonAvg(raw, fields) {
  if (!raw) return null
  // Try nested averages/per_game keys first
  for (const key of ['averages', 'per_game', 'stats']) {
    const v = sumFields(raw[key], fields)
    if (v !== null) return v
  }
  // Try flat root object (some endpoints return stats at top level)
  return sumFields(raw, fields)
}

// Extract player stats from a single game object.
// PandaScore game.players entries: { player: {id}, kills, deaths, … }
function statFromGame(game, playerId, fields) {
  const players = game.players || game.results || []
  const entry = players.find(
    p => p.player?.id === playerId || p.player_id === playerId,
  )
  return entry ? sumFields(entry, fields) : null
}

function computeLast5(recentGames, playerId, fields) {
  if (!Array.isArray(recentGames) || !recentGames.length) return null
  const values = []
  for (const game of recentGames.slice(0, 5)) {
    const v = statFromGame(game, playerId, fields)
    if (v !== null) values.push(v)
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

async function apiFetch(params) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/pandascore?${qs}`)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

let _firstLogDone = false // log only the first player to avoid console spam

export function usePandaScore(projections) {
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    if (!projections.length) return
    let cancelled = false

    const uniquePlayers = [
      ...new Map(
        projections
          .filter(p => !fetchedRef.current.has(`${p.league}:${p.playerName}`))
          .map(p => [`${p.league}:${p.playerName}`, p]),
      ).values(),
    ]

    if (!uniquePlayers.length) return
    setLoading(true)

    async function fetchOne(p, isFirst) {
      const key = `${p.league}:${p.playerName}`
      fetchedRef.current.add(key)
      try {
        const player = await apiFetch({ action: 'search', name: p.playerName, game: p.league })

        if (isFirst && !_firstLogDone) {
          _firstLogDone = true
          console.log(`[PandaScore debug] searched "${p.playerName}" (${p.league}) → player:`, player)
        }

        if (!player?.id || cancelled) return

        const [seasonRaw, recentGames] = await Promise.all([
          apiFetch({ action: 'stats',        playerId: player.id, game: p.league }),
          apiFetch({ action: 'recent_stats', playerId: player.id, game: p.league }),
        ])

        if (isFirst) {
          console.log(`[PandaScore debug] "${p.playerName}" seasonRaw:`, seasonRaw)
          console.log(`[PandaScore debug] "${p.playerName}" recentGames (${recentGames?.length ?? 0}):`, recentGames?.[0])
        }

        if (cancelled) return
        setStats(prev => ({
          ...prev,
          [key]: {
            playerId: player.id,
            seasonRaw,
            recentGames: Array.isArray(recentGames) ? recentGames : [],
            name: p.playerName,
            league: p.league,
          },
        }))
      } catch (err) {
        console.warn(`[PandaScore] failed for "${p.playerName}" (${p.league}):`, err.message)
      }
    }

    Promise.allSettled(uniquePlayers.map((p, i) => fetchOne(p, i === 0)))
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [projections])

  const getStatLine = useCallback((playerName, league, statType) => {
    const key = `${league}:${playerName}`
    const entry = stats[key]
    if (!entry) return null

    const fields = (STAT_MAP[league] || {})[statType]
    if (!fields) return null

    const seasonAvg = extractSeasonAvg(entry.seasonRaw, fields)
    const l5 = computeLast5(entry.recentGames, entry.playerId, fields)

    return { seasonAvg, last5Avg: l5 }
  }, [stats])

  const getProbBoost = useCallback((playerName, league, statType, line) => {
    if (!line) return 0
    const sl = getStatLine(playerName, league, statType)
    if (!sl) return 0
    const avg = sl.last5Avg ?? sl.seasonAvg
    if (avg === null) return 0
    const ratio = avg / line
    return Math.max(-0.08, Math.min(0.08, (ratio - 1) * 0.4))
  }, [getStatLine])

  return { getStatLine, getProbBoost, psLoading: loading }
}
