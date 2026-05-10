import { useState, useEffect, useRef, useCallback } from 'react'

async function fetchStats(name, game, statType, line) {
  try {
    const qs = new URLSearchParams({ name, game, statType, line: String(line) })
    const res = await fetch(`/api/esports-stats?${qs}`)
    if (!res.ok) return null
    return res.json().catch(() => null)
  } catch {
    return null
  }
}

// Renamed from usePandaScore but kept as the same export so no other file needs to change.
export function usePandaScore(projections) {
  // stats key: "LEAGUE:playerName:statType" → { seasonAvg, last5Avg, source, probability }
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    if (!projections.length) return
    let cancelled = false

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
        const result = await fetchStats(p.playerName, p.league, p.statType, p.line)
        if (cancelled || !result) return
        if (result) {
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

  // Returns the server-computed probability for a pick, or null if not yet loaded.
  const getCalcProb = useCallback((playerName, league, statType) => {
    return stats[`${league}:${playerName}:${statType}`]?.probability ?? null
  }, [stats])

  return { getStatLine, getCalcProb, psLoading: loading }
}
