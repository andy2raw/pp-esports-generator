import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { getEffectiveMult } from '../utils/ev.js'

const STAKE = 10

// The slips table was created without an id or created_at column.
// We derive a stable pseudo-ID from fields that together uniquely identify a slip.
function rowKey(row) {
  return `${row.slip_type}|${row.legs}|${Number(row.ev).toFixed(8)}|${Number(row.joint_prob).toFixed(8)}`
}

// Map a Supabase row back to the shape the UI expects.
function rowToSlip(row) {
  return {
    id:          row.id ?? rowKey(row),
    timestamp:   row.created_at
                   ?? (Array.isArray(row.players) && row.players[0]?.startTime)
                   ?? new Date().toISOString(),
    picks:       Array.isArray(row.players) ? row.players : [],
    legCount:    row.legs,
    goblinCount: row.goblin_count || 0,
    ev:          row.ev || 0,
    jointProb:   row.joint_prob || 0,
    result:      row.result || 'Pending',
    missedLeg:   row.missed_leg || null,
    slipType:    row.slip_type,
    league:      row.league,
    _raw:        { slip_type: row.slip_type, legs: row.legs, ev: row.ev, joint_prob: row.joint_prob },
  }
}

// Target a specific row in Supabase. Uses the id column when present (a real UUID
// won't contain '|'), otherwise falls back to the 4-field composite key.
function applySlipFilter(query, slip) {
  if (slip.id && !String(slip.id).includes('|')) {
    return query.eq('id', slip.id)
  }
  const r = slip._raw
  return query
    .eq('slip_type', r.slip_type)
    .eq('legs', r.legs)
    .eq('ev', r.ev)
    .eq('joint_prob', r.joint_prob)
}

export function useSlipTracker() {
  const [trackedSlips, setTrackedSlips] = useState([])
  const [supabaseLoading, setSupabaseLoading] = useState(true)

  // Keep a ref so write callbacks can find slips without closing over state.
  const slipsRef = useRef(trackedSlips)
  useEffect(() => { slipsRef.current = trackedSlips }, [trackedSlips])

  // ── Load existing slips on mount ──────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('slips')
      .select('*')
      .then(({ data, error }) => {
        if (error) {
          console.error('[Supabase] fetch error:', error.message)
        } else {
          setTrackedSlips((data || []).map(rowToSlip))
        }
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

    const { data, error } = await supabase.from('slips').upsert(row, { onConflict: 'id' }).select().single()
    if (error) { console.error('[Supabase] upsert error:', error.message); return }
    setTrackedSlips(prev => [rowToSlip(data), ...prev])
  }, [])

  const setResult = useCallback(async (id, result) => {
    const slip = slipsRef.current.find(s => s.id === id)
    if (!slip) return

    // Optimistic update; also clear missedLeg when changing away from Loss
    const missedLeg = result === 'Loss' ? slip.missedLeg : null
    setTrackedSlips(prev => prev.map(s => s.id === id ? { ...s, result, missedLeg } : s))

    const { error } = await applySlipFilter(
      supabase.from('slips').update({ result, missed_leg: missedLeg }),
      slip,
    )
    if (error) {
      console.error('[Supabase] update error:', error.message)
      setTrackedSlips(prev => prev.map(s => s.id === id ? { ...s, result: slip.result, missedLeg: slip.missedLeg } : s))
    }
  }, [])

  const setMissedLeg = useCallback(async (id, playerName) => {
    const slip = slipsRef.current.find(s => s.id === id)
    if (!slip) return

    // Optimistic update
    setTrackedSlips(prev => prev.map(s => s.id === id ? { ...s, missedLeg: playerName } : s))

    const { error } = await applySlipFilter(
      supabase.from('slips').update({ missed_leg: playerName }),
      slip,
    )
    if (error) {
      // missed_leg column may not exist yet — log clearly so the user can add it
      console.error('[Supabase] missed_leg update error:', error.message,
        '\nRun in Supabase SQL editor: ALTER TABLE slips ADD COLUMN missed_leg text;')
      // Keep the optimistic state so the learning system still benefits in-session
    }
  }, [])

  const removeSlip = useCallback(async (id) => {
    const slip = slipsRef.current.find(s => s.id === id)
    if (!slip) return

    // Optimistic remove
    setTrackedSlips(prev => prev.filter(s => s.id !== id))

    const { error } = await applySlipFilter(supabase.from('slips').delete(), slip)
    if (error) {
      console.error('[Supabase] delete error:', error.message)
      setTrackedSlips(prev => [slip, ...prev])
    }
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────

  const playerHistory = useMemo(() => {
    const h = {}
    for (const slip of trackedSlips) {
      if (slip.result === 'Pending') continue
      for (const pick of slip.picks) {
        const key = pick.playerName
        if (!h[key]) h[key] = { name: key, hits: 0, misses: 0 }
        if (slip.result === 'Win') {
          h[key].hits++
        } else {
          // Loss: if we know which leg missed, only that player gets a miss;
          // the others came through and should get credit for hitting.
          if (slip.missedLeg) {
            if (pick.playerName === slip.missedLeg) h[key].misses++
            else h[key].hits++
          } else {
            h[key].misses++
          }
        }
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
    setMissedLeg,
    removeSlip,
    playerHistory,
    playerScores,
    wins, losses, pending, pnl, winRate, settled,
    supabaseLoading,
  }
}
