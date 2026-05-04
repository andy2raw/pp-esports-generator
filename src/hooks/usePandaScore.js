import { useState, useEffect, useRef } from 'react'

const STAT_MAP = {
  LOL: {
    'Kills': ['kills'],
    'Deaths': ['deaths'],
    'Assists': ['assists'],
    'CS': ['minions_killed', 'neutral_minions_killed'],
    'Gold Earned': ['gold_earned'],
    'KDA': null,
  },
  CSGO: {
    'Kills': ['kills'],
    'Deaths': ['deaths'],
    'Assists': ['assists'],
    'Headshots': ['headshots'],
    'Rating': null,
  },
  VAL: {
    'Kills': ['kills'],
    'Deaths': ['deaths'],
    'Assists': ['assists'],
    'Headshots': ['headshots'],
  },
  DOTA2: {
    'Kills': ['kills'],
    'Deaths': ['deaths'],
    'Assists': ['assists'],
    'Last Hits': ['last_hits'],
    'Gold Per Min': ['gold_per_min'],
  },
}

function sumFields(obj, fields) {
  if (!fields || !obj) return null
  let total = 0
  for (const f of fields) {
    const v = obj[f]
    if (v == null) return null
    total += parseFloat(v) || 0
  }
  return total
}

async function searchPlayer(name, game) {
  const res = await fetch(
    `/api/pandascore?action=search&name=${encodeURIComponent(name)}&game=${game}`,
  )
  if (!res.ok) return null
  return res.json()
}

async function fetchStats(playerId, game) {
  const res = await fetch(`/api/pandascore?action=stats&playerId=${playerId}&game=${game}`)
  if (!res.ok) return null
  return res.json()
}

export function usePandaScore(projections) {
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    if (!projections.length) return
    let cancelled = false

    const toFetch = projections.filter(
      p => !fetchedRef.current.has(`${p.league}:${p.playerName}`),
    )

    if (!toFetch.length) return
    setLoading(true)

    async function run() {
      const uniquePlayers = [...new Map(toFetch.map(p => [`${p.league}:${p.playerName}`, p])).values()]

      await Promise.allSettled(
        uniquePlayers.map(async p => {
          const key = `${p.league}:${p.playerName}`
          fetchedRef.current.add(key)
          try {
            const player = await searchPlayer(p.playerName, p.league)
            if (!player || cancelled) return
            const s = await fetchStats(player.id, p.league)
            if (!s || cancelled) return
            const entry = { playerId: player.id, raw: s, name: p.playerName, league: p.league }
            if (!cancelled) {
              setStats(prev => ({ ...prev, [key]: entry }))
            }
          } catch {}
        }),
      )

      if (!cancelled) setLoading(false)
    }

    run()
    return () => { cancelled = true }
  }, [projections])

  function getStatLine(playerName, league, statType) {
    const key = `${league}:${playerName}`
    const entry = stats[key]
    if (!entry) return null

    const gameMap = STAT_MAP[league] || {}
    const fields = gameMap[statType]
    if (fields === undefined) return null

    const raw = entry.raw
    const seasonAvg = sumFields(raw?.averages || raw, fields)

    return { seasonAvg, last5Avg: null }
  }

  return { getStatLine, psLoading: loading }
}
