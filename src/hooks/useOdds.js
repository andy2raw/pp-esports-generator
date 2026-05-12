import { useState, useEffect, useCallback } from 'react'

function normName(n) {
  return (n || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function useOdds() {
  const [lines, setLines] = useState({})

  useEffect(() => {
    console.log('[useOdds] fetching /api/odds…')
    fetch('/api/odds')
      .then(r => {
        console.log('[useOdds] response status:', r.status)
        return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      })
      .then(data => {
        const count = Object.keys(data?.lines ?? {}).length
        console.log(`[useOdds] received ${count} market line entries, debug="${data?.debug ?? ''}", updatedAt=${data?.updatedAt ?? '?'}`)
        if (count > 0) {
          const sample = Object.entries(data.lines).slice(0, 3)
          sample.forEach(([k, v]) => console.log(`[useOdds] sample: ${k} →`, v))
        }
        if (data?.lines) setLines(data.lines)
      })
      .catch(e => console.error('[useOdds] fetch error:', e.message))
  }, [])

  const getMarketLines = useCallback((playerName, statType) => {
    const key = `${normName(playerName)}::${statType}`
    const result = lines[key] ?? null
    return result
  }, [lines])

  return { getMarketLines }
}
