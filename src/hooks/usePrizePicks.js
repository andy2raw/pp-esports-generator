import { useState, useEffect, useCallback, useRef } from 'react'
import { estimateProb } from '../utils/ev.js'

const API_URL = '/api/prizepicks'
const REFRESH_MS = 5 * 60 * 1000
const ALLOWED_LEAGUES = new Set(['LOL', 'CSGO', 'CS2', 'VAL', 'DOTA2', 'MLB'])

export function usePrizePicks() {
  const [projections, setProjections] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(300)
  const timerRef = useRef(null)
  const countRef = useRef(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      const inc = {}
      for (const item of json.included || []) {
        if (!inc[item.type]) inc[item.type] = {}
        inc[item.type][item.id] = item
      }

      // ── League diagnostics (browser console) ──────────────────────────────
      const allData = json.data || []
      // First 10 raw league fields so we can see exact strings PrizePicks sends
      console.log('[pp-raw] first 10 props league fields:',
        allData.slice(0, 10).map(p => {
          const playerRef = p.relationships?.new_player?.data
          const player = playerRef ? inc?.new_player?.[playerRef.id] : null
          return {
            id:           p.id,
            status:       p.attributes?.status,
            league_name:  player?.attributes?.league_name,
            league:       player?.attributes?.league,
            attr_league:  p.attributes?.league,
            stat_type:    p.attributes?.stat_type,
          }
        }),
      )
      // Count every unique league across ALL props (pre-filter)
      const rawLeagueCounts = {}
      for (const p of allData) {
        const playerRef = p.relationships?.new_player?.data
        const player = playerRef ? inc?.new_player?.[playerRef.id] : null
        const raw = (
          player?.attributes?.league_name ||
          player?.attributes?.league ||
          p.attributes?.league ||
          'UNKNOWN'
        )
        rawLeagueCounts[raw] = (rawLeagueCounts[raw] || 0) + 1
      }
      console.log('[pp-leagues] ALL props by league (pre-filter, total=' + allData.length + '):', rawLeagueCounts)
      // ──────────────────────────────────────────────────────────────────────

      const parsed = (json.data || [])
        .filter(p => {
          const s = p.attributes?.status
          return s === 'pre_game' || s === 'in_progress'
        })
        .map(p => {
          const a = p.attributes || {}
          const playerRef = p.relationships?.new_player?.data
          const player = playerRef ? inc?.new_player?.[playerRef.id] : null

          const leagueRaw = (
            player?.attributes?.league_name ||
            player?.attributes?.league ||
            a.league ||
            ''
          ).toUpperCase()

          const league = leagueRaw === 'CS2' ? 'CSGO' : leagueRaw

          if (!ALLOWED_LEAGUES.has(leagueRaw) && !ALLOWED_LEAGUES.has(league)) return null

          const line = parseFloat(a.line_score) || 0

          return {
            id: p.id,
            playerName: player?.attributes?.display_name || a.description || 'Unknown',
            team: player?.attributes?.team_name || player?.attributes?.team || '',
            position: player?.attributes?.position || '',
            league,
            statType: a.stat_type || '',
            line,
            startTime: a.start_time,
            isPromo: Boolean(a.is_promo),
            oddsType: a.odds_type || 'standard',
            status: a.status,
            probability: estimateProb(a),
          }
        })
        .filter(Boolean)
        .filter(p => !/\bMAPS?\b/i.test(p.playerName))

      // Deduplicate: one prop per player+stat. Prefer the non-goblin line;
      // only keep the goblin version when no standard line exists.
      const seen = new Map()
      for (const p of parsed) {
        const key = `${p.playerName}::${p.statType}`
        const existing = seen.get(key)
        if (!existing) {
          seen.set(key, p)
        } else if (existing.oddsType === 'goblin' && p.oddsType !== 'goblin') {
          // Replace goblin with the standard line
          seen.set(key, p)
        }
        // If existing is standard and current is goblin, skip current
      }
      const deduped = [...seen.values()]

      // Post-filter league counts
      const filteredLeagueCounts = {}
      for (const p of deduped) {
        filteredLeagueCounts[p.league] = (filteredLeagueCounts[p.league] || 0) + 1
      }
      console.log('[pp-leagues] FILTERED props by league (total=' + deduped.length + '):', filteredLeagueCounts)

      setProjections(deduped)
      setLastRefresh(new Date())
      setCountdown(300)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    timerRef.current = setInterval(fetchData, REFRESH_MS)
    countRef.current = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => {
      clearInterval(timerRef.current)
      clearInterval(countRef.current)
    }
  }, [fetchData])

  return { projections, loading, error, lastRefresh, countdown, refresh: fetchData }
}
