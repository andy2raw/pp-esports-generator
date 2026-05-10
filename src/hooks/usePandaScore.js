import { useState, useEffect, useRef, useCallback } from 'react'

async function fetchStats(name, game, statType) {
  try {
    const qs = new URLSearchParams({ name, game, statType })
    const res = await fetch(`/api/esports-stats?${qs}`)
    if (!res.ok) return null
    return res.json().catch(() => null)
  } catch {
    return null
  }
}

// Renamed from usePandaScore but kept as the same export so no other file needs to change.
export function usePandaScore(projections) {
  // stats key: "LEAGUE:playerName:statType" → { seasonAvg, last5Avg, source }
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    if (!projections.length) return
    let cancelled = false

    // Collect unique (player, league, statType) triples that haven't been fetched yet.
    // Skip combo picks like "Sasi + climber + Saber".
    const toFetch = []
    const seen = new Set()
    for (const p of projections) {
      if (!p.playerName || p.playerName.includes('+') || p.playerName.includes('&')) continue
      const key = `${p.league}:${p.playerName}:${p.statType}`
      if (!fetchedRef.current.has(key) && !seen.has(key)) {
        seen.add(key)
        toFetch.push(p)
      }
    }
    if (!toFetch.length) return

    setLoading(true)

    Promise.allSettled(
      toFetch.map(async p => {
        const key = `${p.league}:${p.playerName}:${p.statType}`
        fetchedRef.current.add(key)
        const result = await fetchStats(p.playerName, p.league, p.statType)
        if (cancelled || !result) return
        if (result.seasonAvg !== null || result.last5Avg !== null) {
          setStats(prev => ({ ...prev, [key]: result }))
        }
      }),
    ).finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [projections])

  const getStatLine = useCallback((playerName, league, statType) => {
    const entry = stats[`${league}:${playerName}:${statType}`]
    if (!entry) return null
    return { seasonAvg: entry.seasonAvg, last5Avg: entry.last5Avg }
  }, [stats])

  const getProbBoost = useCallback((playerName, league, statType, line) => {
    if (!line) return 0
    const sl = getStatLine(playerName, league, statType)
    if (!sl) return 0
    const a = sl.last5Avg ?? sl.seasonAvg
    if (a === null) return 0
    return Math.max(-0.08, Math.min(0.08, (a / line - 1) * 0.4))
  }, [getStatLine])

  return { getStatLine, getProbBoost, psLoading: loading }
}
