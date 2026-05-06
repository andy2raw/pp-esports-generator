import { useState, useMemo, useCallback } from 'react'
import { getEffectiveMult } from '../utils/ev.js'

const STAKE = 10

export function useSlipTracker() {
  const [trackedSlips, setTrackedSlips] = useState([])

  const addSlip = useCallback((combo) => {
    setTrackedSlips(prev => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      picks: combo.picks,
      legCount: combo.picks.length,
      goblinCount: combo.goblinCount || 0,
      ev: combo.ev,
      jointProb: combo.jointProb,
      result: 'pending',
    }, ...prev])
  }, [])

  const setResult = useCallback((id, result) => {
    setTrackedSlips(prev => prev.map(s => s.id === id ? { ...s, result } : s))
  }, [])

  const removeSlip = useCallback((id) => {
    setTrackedSlips(prev => prev.filter(s => s.id !== id))
  }, [])

  const playerHistory = useMemo(() => {
    const h = {}
    for (const slip of trackedSlips) {
      if (slip.result === 'pending') continue
      for (const pick of slip.picks) {
        const key = pick.playerName
        if (!h[key]) h[key] = { name: key, hits: 0, misses: 0 }
        if (slip.result === 'win') h[key].hits++
        else h[key].misses++
      }
    }
    return h
  }, [trackedSlips])

  const wins = useMemo(() => trackedSlips.filter(s => s.result === 'win').length, [trackedSlips])
  const losses = useMemo(() => trackedSlips.filter(s => s.result === 'loss').length, [trackedSlips])
  const pending = useMemo(() => trackedSlips.filter(s => s.result === 'pending').length, [trackedSlips])

  const pnl = useMemo(() => trackedSlips
    .filter(s => s.result !== 'pending')
    .reduce((sum, s) => {
      const mult = getEffectiveMult(s.legCount, s.goblinCount)
      return s.result === 'win' ? sum + STAKE * mult - STAKE : sum - STAKE
    }, 0),
    [trackedSlips],
  )

  const settled = wins + losses
  const winRate = settled > 0 ? (wins / settled * 100).toFixed(1) : null

  // Score 0-1 per player: used to deprioritize losers in combo generation.
  // Only applied once a player has 2+ settled slips to avoid overreacting.
  const playerScores = useMemo(() => {
    const scores = {}
    for (const [name, h] of Object.entries(playerHistory)) {
      if (h.hits + h.misses >= 2) {
        scores[name] = h.hits / (h.hits + h.misses)
      }
    }
    return scores
  }, [playerHistory])

  return {
    trackedSlips,
    addSlip,
    setResult,
    removeSlip,
    playerHistory,
    playerScores,
    wins,
    losses,
    pending,
    pnl,
    winRate,
    settled,
  }
}
