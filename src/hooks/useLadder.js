import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

export const STARTING_BANKROLL = 10
export const MULTIPLIER = 3

export function useLadder() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('ladder')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('[Ladder] fetch error:', error.message)
        else setEntries(data || [])
        setLoading(false)
      })
  }, [])

  // Derived state from settled entries
  const settled = useMemo(() => entries.filter(e => e.result !== 'Pending'), [entries])

  const currentBankroll = useMemo(() => {
    if (!settled.length) return STARTING_BANKROLL
    const last = settled[settled.length - 1]
    return last.result === 'Win' ? last.bankroll * MULTIPLIER : STARTING_BANKROLL
  }, [settled])

  const currentStreak = useMemo(() => {
    let streak = 0
    for (let i = settled.length - 1; i >= 0; i--) {
      if (settled[i].result === 'Win') streak++
      else break
    }
    return streak
  }, [settled])

  const bestStreak = useMemo(() => {
    let best = 0, run = 0
    for (const e of settled) {
      run = e.result === 'Win' ? run + 1 : 0
      best = Math.max(best, run)
    }
    return best
  }, [settled])

  const pendingEntry = entries.find(e => e.result === 'Pending')

  // Bankroll history for chart: starting value + one point per settled entry
  const chartData = useMemo(() => {
    const points = [STARTING_BANKROLL]
    let br = STARTING_BANKROLL
    for (const e of settled) {
      br = e.result === 'Win' ? e.bankroll * MULTIPLIER : STARTING_BANKROLL
      points.push(br)
    }
    return points
  }, [settled])

  const addEntry = useCallback(async (slip) => {
    const row = {
      streak:       currentStreak,
      bankroll:     currentBankroll,
      result:       'Pending',
      slip_picks:   slip.picks,
      entry_amount: currentBankroll,
    }
    const { data, error } = await supabase.from('ladder').insert(row).select().single()
    if (error) { console.error('[Ladder] insert error:', error.message); return }
    setEntries(prev => [...prev, data])
  }, [currentBankroll, currentStreak])

  const recordResult = useCallback(async (id, result) => {
    const entry = entries.find(e => e.id === id)
    if (!entry) return

    const { error } = await supabase.from('ladder').update({ result }).eq('id', id)
    if (error) { console.error('[Ladder] update error:', error.message); return }

    setEntries(prev => prev.map(e => e.id === id ? { ...e, result } : e))
  }, [entries])

  const restart = useCallback(async () => {
    const { error } = await supabase.from('ladder').delete().lte('created_at', new Date().toISOString())
    if (error) { console.error('[Ladder] restart error:', error.message); return }
    setEntries([])
  }, [])

  return {
    entries,
    loading,
    currentBankroll,
    currentStreak,
    bestStreak,
    pendingEntry,
    chartData,
    addEntry,
    recordResult,
    restart,
  }
}
