import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { getEffectiveMult } from '../utils/ev.js'

const STAKE = 10

// Map a Supabase row back to the shape the UI expects.
function rowToSlip(row) {
  return {
    id:          row.id,
    timestamp:   row.created_at,
    picks:       Array.isArray(row.players) ? row.players : [],
    legCount:    row.legs,
    goblinCount: row.goblin_count || 0,
    ev:          row.ev || 0,
    jointProb:   row.joint_prob || 0,
    result:      row.result || 'Pending',
    slipType:    row.slip_type,
    league:      row.league,
  }
}

export function useSlipTracker() {
  const [trackedSlips, setTrackedSlips] = useState([])
  const [supabaseLoading, setSupabaseLoading] = useState(true)

  // ── Load existing slips on mount ──────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('slips')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('[Supabase] fetch error:', error.message)
        else setTrackedSlips((data || []).map(rowToSlip))
        setSupabaseLoading(false)
      })
  }, [])

  // ── Write operations ──────────────────────────────────────────────────────

  const addSlip = useCallback(async (combo, slipType, league) => {
    const row = {
      slip_type:    slipType,
      players:      combo.picks,
      legs:         combo.picks.length,
      goblin_count: combo.goblinCount || 0,
      ev:           combo.ev,
      joint_prob:   combo.jointProb,
      result:       'Pending',
      bet_amount:   0,
      payout:       0,
      league:       league || 'ALL',
    }

    const { data, error } = await supabase.from('slips').insert(row).select().single()
    if (error) { console.error('[Supabase] insert error:', error.message); return }
    setTrackedSlips(prev => [rowToSlip(data), ...prev])
  }, [])

  const setResult = useCallback(async (id, result) => {
    const { error } = await supabase.from('slips').update({ result }).eq('id', id)
    if (error) { console.error('[Supabase] update error:', error.message); return }
    setTrackedSlips(prev => prev.map(s => s.id === id ? { ...s, result } : s))
  }, [])

  const removeSlip = useCallback(async (id) => {
    const { error } = await supabase.from('slips').delete().eq('id', id)
    if (error) { console.error('[Supabase] delete error:', error.message); return }
    setTrackedSlips(prev => prev.filter(s => s.id !== id))
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────

  const playerHistory = useMemo(() => {
    const h = {}
    for (const slip of trackedSlips) {
      if (slip.result === 'Pending') continue
      for (const pick of slip.picks) {
        const key = pick.playerName
        if (!h[key]) h[key] = { name: key, hits: 0, misses: 0 }
        if (slip.result === 'Win') h[key].hits++
        else h[key].misses++
      }
    }
    return h
  }, [trackedSlips])

  const wins    = useMemo(() => trackedSlips.filter(s => s.result === 'Win').length,     [trackedSlips])
  const losses  = useMemo(() => trackedSlips.filter(s => s.result === 'Loss').length,    [trackedSlips])
  const pending = useMemo(() => trackedSlips.filter(s => s.result === 'Pending').length, [trackedSlips])

  const pnl = useMemo(() =>
    trackedSlips
      .filter(s => s.result !== 'Pending')
      .reduce((sum, s) => {
        const mult = getEffectiveMult(s.legCount, s.goblinCount)
        return s.result === 'Win' ? sum + STAKE * mult - STAKE : sum - STAKE
      }, 0),
    [trackedSlips],
  )

  const settled = wins + losses
  const winRate = settled > 0 ? (wins / settled * 100).toFixed(1) : null

  // Score 0–1 per player based on historical hit rate.
  // Only applied after 2+ settled slips to avoid overreacting to small samples.
  const playerScores = useMemo(() => {
    const scores = {}
    for (const [name, h] of Object.entries(playerHistory)) {
      if (h.hits + h.misses >= 2) scores[name] = h.hits / (h.hits + h.misses)
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
    wins, losses, pending, pnl, winRate, settled,
    supabaseLoading,
  }
}
