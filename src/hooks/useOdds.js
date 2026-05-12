import { useState, useEffect, useCallback } from 'react'

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

export function useOdds() {
  const [lines, setLines] = useState({})

  useEffect(() => {
    fetch('/api/odds')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.lines) setLines(data.lines) })
      .catch(e => console.warn('[useOdds]', e.message))
  }, [])

  // Returns { dk, fd } when market data exists for this player+stat, else null.
  const getMarketLines = useCallback((playerName, statType) => {
    const key = `${normName(playerName)}::${statType}`
    return lines[key] ?? null
  }, [lines])

  return { getMarketLines }
}
