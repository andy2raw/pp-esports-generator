import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

export const STARTING_BANKROLL = 10
export const MULTIPLIER = 3

export const TIERS = [
  {
    name: 'BEGINNER', min: 0,   max: 50,
    minJointProb: 0.40, minConfidence: 0, noGoblins: false, noDemons: false,
    description: 'Best available Precision 2-Leg, 40%+ joint probability',
  },
  {
    name: 'BUILDER',  min: 50,  max: 200,
    minJointProb: 0.55, minConfidence: 6, noGoblins: false, noDemons: false,
    description: '55%+ joint probability, confidence 6+',
  },
  {
    name: 'SERIOUS',  min: 200, max: 500,
    minJointProb: 0.65, minConfidence: 7, noGoblins: true,  noDemons: false,
    description: '65%+ joint probability, confidence 7+, no goblins',
  },
  {
    name: 'SHARP',    min: 500, max: Infinity,
    minJointProb: 0.70, minConfidence: 8, noGoblins: true,  noDemons: true,
    description: '70%+ joint probability, confidence 8+, standard lines only',
  },
]

export function getTier(bankroll) {
  return TIERS.find(t => bankroll >= t.min && bankroll < t.max) ?? TIERS[TIERS.length - 1]
}

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

  const settled = useMemo(() => entries.filter(e => e.result !== 'Pending'), [entries])

  const currentBankroll = useMemo(() => {
    if (!settled.length) return STARTING_BANKROLL
    const last = settled[settled.length - 1]
    if (last.result === 'Win')  return last.bankroll * MULTIPLIER
    if (last.result === 'Loss') return STARTING_BANKROLL
    // Skip — preserve bankroll stored on that entry
    return last.bankroll
  }, [settled])

  const currentStreak = useMemo(() => {
    let streak = 0
    for (let i = settled.length - 1; i >= 0; i--) {
      if (settled[i].result === 'Skip') continue  // skips don't break a streak
      if (settled[i].result === 'Win') streak++
      else break
    }
    return streak
  }, [settled])

  const bestStreak = useMemo(() => {
    let best = 0, run = 0
    for (const e of settled) {
      if (e.result === 'Skip') continue
      run = e.result === 'Win' ? run + 1 : 0
      best = Math.max(best, run)
    }
    return best
  }, [settled])

  // True when the most recent Win moved the bankroll into a higher tier.
  const tierJustChanged = useMemo(() => {
    const wins = settled.filter(e => e.result === 'Win')
    if (!wins.length) return false
    const last = wins[wins.length - 1]
    return getTier(last.bankroll).name !== getTier(currentBankroll).name
  }, [settled, currentBankroll])

  const pendingEntry = entries.find(e => e.result === 'Pending')

  const chartData = useMemo(() => {
    const points = [STARTING_BANKROLL]
    let br = STARTING_BANKROLL
    for (const e of settled) {
      if (e.result === 'Win')  br = e.bankroll * MULTIPLIER
      else if (e.result === 'Loss') br = STARTING_BANKROLL
      // Skip: br unchanged
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
    tierJustChanged,
    pendingEntry,
    chartData,
    addEntry,
    recordResult,
    restart,
  }
}
