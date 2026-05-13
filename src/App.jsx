import { useState, useMemo } from 'react'
import { usePrizePicks } from './hooks/usePrizePicks.js'
import { usePandaScore } from './hooks/usePandaScore.js'
import { useSlipTracker } from './hooks/useSlipTracker.js'
import { bestCombos } from './utils/combos.js'
import { fmtPct, fmtEV, probColor, calcEV, calcConfidence, isLock, isGoblin } from './utils/ev.js'
import SlipCard from './components/SlipCard.jsx'
import StatsBadge from './components/StatsBadge.jsx'
import SlipTracker from './components/SlipTracker.jsx'
import DailyQuote from './components/DailyQuote.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import LadderChallenge from './components/LadderChallenge.jsx'
import { useOdds } from './hooks/useOdds.js'
import ResultsPage from './components/ResultsPage.jsx'

const LEAGUES = ['ALL', 'LOL', 'CSGO', 'VAL', 'DOTA2', 'MLB']

function scoredSort(arr) {
  return [...arr].sort((a, b) => b.probability - a.probability)
}

// CSGO tab covers both "CSGO" and "CS2" — PrizePicks sends "CS2" as the league name.
function inLeague(p, selected) {
  if (selected === 'CSGO') return p.league === 'CSGO' || p.league === 'CS2'
  return p.league === selected
}

// Typical averages per esports game/stat/map-count used as fallback when no player
// stats are available. MLB is excluded — it uses real stats only.
function typicalAvg(league, statType) {
  const g  = (league || '').toUpperCase()
  const st = (statType || '').toLowerCase()
  if (g === 'MLB') return null
  const is12 = /1-2/i.test(st)
  const is13 = /1-3/i.test(st)
  if (st.includes('kill')) {
    if (g === 'CS2' || g === 'CSGO') return is13 ? 42 : is12 ? 28 : 16
    if (g === 'LOL')                  return is13 ? 14 : is12 ? 10 : 6
    if (g === 'VAL')                  return is12 ? 32 : 18
    if (g === 'DOTA2')                return 10
  }
  if (st.includes('headshot')) {
    if (g === 'CS2' || g === 'CSGO') return is12 ? 14 : 8
  }
  if (st.includes('last hit')) {
    if (g === 'DOTA2') return 150
  }
  if (st === 'gpm' || st.includes('gold per min') || st.includes('gold/min')) {
    if (g === 'DOTA2') return 450
  }
  return null
}

// Resolve OVER/UNDER direction, probability, and sharp flag for a single prop.
// When L5/season stats exist: compare to line directly.
// When stats are null: compare line to game/stat typical average.
function resolveOverUnder(statLine, league, statType, line, currentProb) {
  const l5 = statLine?.last5Avg ?? statLine?.seasonAvg

  if (l5 != null) {
    return {
      overUnder:   l5 > line ? 'OVER' : 'UNDER',
      probability: currentProb,
      sharp:       statLine?.sharp ?? false,
    }
  }

  // No player stats — fall back to typical averages (esports only; MLB returns null)
  const typical = typicalAvg(league, statType)
  if (typical == null) return { overUnder: 'OVER', probability: currentProb, sharp: false }

  const ratio = line / typical
  if (ratio > 1.10) {
    // Line is meaningfully above typical → lean UNDER; flip displayed probability
    return { overUnder: 'UNDER', probability: Math.max(0.44, 1 - currentProb), sharp: false }
  }
  if (ratio < 0.90) {
    // Line is meaningfully below typical → lean OVER
    return { overUnder: 'OVER', probability: currentProb, sharp: false }
  }
  // Within 10% of typical → genuine toss-up
  return { overUnder: line >= typical ? 'UNDER' : 'OVER', probability: 0.50, sharp: true }
}

// Leagues used for esports slip generation — MLB and others are display-only.
const ESPORTS_LEAGUES = new Set(['CS2', 'CSGO', 'LOL', 'VAL', 'DOTA2'])

// Attach OVER/UNDER to a combo's picks. If a pick already has overUnder set
// (pre-resolved in resolvedSlipPool) skip re-applying to prevent double-adjustment.
function withOverUnder(combo, getStatLine) {
  return {
    ...combo,
    picks: combo.picks.map(p => {
      if (p.overUnder) return p  // already resolved — don't flip probability again
      const sl = getStatLine(p.playerName, p.league, p.statType)
      const { overUnder, probability, sharp } = resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
      return { ...p, overUnder, probability, sharp }
    }),
  }
}

export default function App() {
  const [league, setLeague] = useState('ALL')
  const [activeTab, setActiveTab] = useState('slips')

  const { projections, loading, error, lastRefresh, countdown, refresh } = usePrizePicks()
  const { getStatLine, getCalcProb, psLoading } = usePandaScore(projections)
  const { getMarketLines } = useOdds()
  const {
    trackedSlips, addSlip, setResult, setMissedLeg, removeSlip,
    playerHistory, wins, losses, pnl, winRate, settled, pending,
    supabaseLoading,
  } = useSlipTracker()

  const adjustedProjections = useMemo(
    () => projections.map(p => {
      const serverProb = getCalcProb(p.playerName, p.league, p.statType)
      const prob = serverProb ?? p.probability
      return { ...p, probability: prob }
    }),
    [projections, getCalcProb],
  )

  // Attach market line data from The Odds API (MLB only in practice).
  // sharpValue = true when PP line is softer (easier to hit) than market consensus.
  const enrichedProjections = useMemo(() =>
    adjustedProjections.map(p => {
      const ml = getMarketLines(p.playerName, p.statType)
      if (!ml) return p
      const consensus = ml.dk != null && ml.fd != null
        ? (ml.dk + ml.fd) / 2
        : (ml.dk ?? ml.fd)
      const isUnder   = p.overUnder === 'UNDER'
      // OVER: PP line below consensus = easier to go over → sharp value
      // UNDER: PP line above consensus = easier to go under → sharp value
      const sharpValue = consensus != null &&
        (isUnder ? p.line > consensus : p.line < consensus)
      return { ...p, marketLines: ml, sharpValue: sharpValue || undefined }
    }),
    [adjustedProjections, getMarketLines],
  )

  const filtered = useMemo(
    () => league === 'ALL' ? enrichedProjections : enrichedProjections.filter(p => inLeague(p, league)),
    [enrichedProjections, league],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.probability - a.probability),
    [filtered],
  )

  // Esports-only projections — MLB and other sports are excluded from slip generation.
  const esportsProjections = useMemo(
    () => enrichedProjections.filter(p => ESPORTS_LEAGUES.has(p.league)),
    [enrichedProjections],
  )

  const mlbProjections = useMemo(
    () => enrichedProjections.filter(p => p.league === 'MLB'),
    [enrichedProjections],
  )

  // Pre-resolve OVER/UNDER for every esports prop so bestCombos scores by
  // direction-adjusted probability (not raw server prob). Log first 10 for verification.
  const resolvedSlipPool = useMemo(() => {
    const resolved = esportsProjections.map(p => {
      const sl = getStatLine(p.playerName, p.league, p.statType)
      const { overUnder, probability, sharp } = resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
      return { ...p, overUnder, probability, sharp }
    })
    const typical10 = resolved.slice(0, 10)
    typical10.forEach(p => {
      const typical = typicalAvg(p.league, p.statType)
      console.log(`[ou] ${p.league} "${p.playerName}" line=${p.line} typical=${typical ?? 'n/a'} → ${p.overUnder} ${p.probability.toFixed(3)}`)
    })
    return resolved
  }, [esportsProjections, getStatLine])

  // MLB props resolved with OVER/UNDER from real L5 stats (via usePandaScore → mlb-stats).
  const resolvedMlbPool = useMemo(() =>
    scoredSort(mlbProjections.map(p => {
      const sl = getStatLine(p.playerName, p.league, p.statType)
      const { overUnder, probability, sharp } = resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
      return { ...p, overUnder, probability, sharp }
    })),
    [mlbProjections, getStatLine],
  )

  // slipPool: source depends on the active league tab.
  //   MLB  → MLB props only
  //   ALL  → esports + MLB blended
  //   else → esports tab, prioritise selected league
  const slipPool = useMemo(() => {
    if (league === 'MLB') return resolvedMlbPool
    if (league === 'ALL') return scoredSort([...resolvedSlipPool, ...resolvedMlbPool])
    const primary   = scoredSort(resolvedSlipPool.filter(p => inLeague(p, league)))
    const secondary = scoredSort(resolvedSlipPool.filter(p => !inLeague(p, league)))
    return [...primary, ...secondary]
  }, [resolvedSlipPool, resolvedMlbPool, league])

  const lotteryPool = useMemo(() => scoredSort(resolvedSlipPool), [resolvedSlipPool])

  // Under pool: single-player esports props only, line ≥20% above typical avg.
  // Combo props ("+", "&" in player name) are excluded — their summed lines
  // inflate ratios and push everything to the 0.82 cap.
  // underProb = min(0.82, 0.50 + (ratio-1.20)*0.75).
  // fadeStrength is stored as integer % (e.g., 31 → "31% ABOVE AVG").
  const underPool = useMemo(() => {
    const qualified = []
    for (const p of esportsProjections) {
      // Skip combo/multi-player props
      if (p.playerName.includes('+') || p.playerName.includes('&')) continue
      const typical = typicalAvg(p.league, p.statType)
      if (typical == null) continue
      const ratio = p.line / typical
      if (ratio < 1.20) continue  // Not a strong enough fade
      const underProb    = Math.min(0.82, 0.50 + (ratio - 1.20) * 0.75)
      const fadeStrength = Math.round((ratio - 1) * 100)
      console.log(`[under] "${p.playerName}" line=${p.line} typical=${typical} ratio=${ratio.toFixed(3)} → ${underProb.toFixed(3)}`)
      qualified.push({ ...p, overUnder: 'UNDER', probability: underProb, sharp: false, fadeStrength })
    }
    return scoredSort(qualified)
  }, [esportsProjections])

  const underRaw = useMemo(() => {
    if (underPool.length < 2) return { u2: [], u3: [], u4: [] }

    function makeCombo(picks) {
      // Highest fade strength first within the combo
      const sorted = [...picks].sort((a, b) => (b.fadeStrength ?? 0) - (a.fadeStrength ?? 0))
      const jointProb = sorted.reduce((acc, p) => acc * p.probability, 1)
      const ev = calcEV(Math.pow(jointProb, 1 / sorted.length), sorted.length, 0)
      return { picks: sorted, ev, jointProb, goblinCount: 0 }
    }

    // Greedy team-aware builder.
    // maxPerTeam: max players from one team in a single combo.
    // minTeams:   minimum distinct teams required (ensures cross-game coverage).
    function buildCombos(pool, legCount, limit, maxPerTeam, minTeams) {
      const combos = []
      const used = new Set()
      while (combos.length < limit) {
        const picks = []
        const teamCounts = {}
        for (const p of pool) {
          if (used.has(p.playerName)) continue
          const team = p.team || `__solo_${p.playerName}`
          if ((teamCounts[team] ?? 0) >= maxPerTeam) continue
          picks.push(p)
          teamCounts[team] = (teamCounts[team] ?? 0) + 1
          if (picks.length === legCount) break
        }
        if (picks.length < legCount) break
        const teamSet = new Set(picks.map(p => p.team || `__solo_${p.playerName}`))
        if (teamSet.size < minTeams) break
        picks.forEach(p => used.add(p.playerName))
        combos.push(makeCombo(picks))
      }
      return combos
    }

    const pool = underPool.slice(0, 20)
    const u2 = buildCombos(pool, 2, 3, 1, 2) // max 1/team, min 2 teams
    const u3 = buildCombos(pool, 3, 3, 2, 2) // max 2/team, min 2 teams
    const u4 = buildCombos(pool, 4, 3, 2, 3) // max 2/team, min 3 teams
    console.log('[underRaw] pool:', underPool.length, 'u2:', u2.length, 'u3:', u3.length, 'u4:', u4.length)
    return { u2, u3, u4 }
  }, [underPool])

  // Top Picks: SHARP VALUE first, then standards, then goblins, then locks.
  // Cap at 2 picks with the same statType+line to avoid 5×"MAPS 1-2 Kills O1.5".
  const topPicks = useMemo(() => {
    const candidates = [
      ...slipPool.filter(p => p.sharpValue),
      ...slipPool.filter(p => !p.sharpValue && !isLock(p.line, p.statType) && !isGoblin(p)),
      ...slipPool.filter(p => !p.sharpValue && !isLock(p.line, p.statType) && isGoblin(p)),
      ...slipPool.filter(p => !p.sharpValue && isLock(p.line, p.statType)),
    ]
    const statLineCounts = {}
    const result = []
    for (const p of candidates) {
      if (result.length >= 6) break
      const key = `${p.statType}|${p.line}`
      const count = statLineCounts[key] || 0
      if (count >= 2) continue
      statLineCounts[key] = count + 1
      result.push(p)
    }
    return result
  }, [slipPool])

  // ── Build all combos with a single shared appearances dict so no player
  //    appears more than 2 times across ALL slips on the page combined.
  //    Core 4-Leg gets first pick (flagship), then 2-leg, 3-leg, lottery.
  const allRaw = useMemo(() => {
    const appearances = {}
    // Core 4-leg: flagship — max 1 demon, require stat/league diversity
    const c4      = bestCombos(slipPool, 4, 3, appearances, { maxDemons: 1, requireDiversity: true })
    // Precision 2-leg: no demons ever
    const c2      = bestCombos(slipPool, 2, 3, appearances, { maxDemons: 0 })
    // Edge 3-leg: max 1 demon
    const c3      = bestCombos(slipPool, 3, 3, appearances, { maxDemons: 1 })
    // Lottery 6-leg: high-variance slip — no demon constraint
    const lottery = bestCombos(lotteryPool, 6, 1, appearances)[0] ?? null
    return { c2, c3, c4, lottery }
  }, [slipPool, lotteryPool])

  // Attach confidence scores and OVER/UNDER to each combo's picks.
  // Sort by jointProb descending so rank 1 = best hit rate.
  const combos2 = useMemo(
    () => allRaw.c2
      .map(c => ({ ...withOverUnder(c, getStatLine), confidence: calcConfidence(c, getStatLine, playerHistory) }))
      .sort((a, b) => b.jointProb - a.jointProb),
    [allRaw.c2, getStatLine, playerHistory],
  )
  const combos3 = useMemo(
    () => allRaw.c3
      .map(c => ({ ...withOverUnder(c, getStatLine), confidence: calcConfidence(c, getStatLine, playerHistory) }))
      .sort((a, b) => b.jointProb - a.jointProb),
    [allRaw.c3, getStatLine, playerHistory],
  )
  const combos4 = useMemo(
    () => allRaw.c4
      .map(c => ({ ...withOverUnder(c, getStatLine), confidence: calcConfidence(c, getStatLine, playerHistory) }))
      .sort((a, b) => b.jointProb - a.jointProb),
    [allRaw.c4, getStatLine, playerHistory],
  )
  const lotterySlip = useMemo(
    () => allRaw.lottery
      ? {
          ...withOverUnder(allRaw.lottery, getStatLine),
          confidence: calcConfidence(allRaw.lottery, getStatLine, playerHistory),
        }
      : null,
    [allRaw.lottery, getStatLine, playerHistory],
  )

  // Under combos: picks already have overUnder/probability resolved — skip withOverUnder.
  const underCombos2 = useMemo(
    () => underRaw.u2.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [underRaw.u2, getStatLine, playerHistory],
  )
  const underCombos3 = useMemo(
    () => underRaw.u3.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [underRaw.u3, getStatLine, playerHistory],
  )
  const underCombos4 = useMemo(
    () => underRaw.u4.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [underRaw.u4, getStatLine, playerHistory],
  )

  const under6Raw = useMemo(() => {
    const byFade = [...underPool].sort((a, b) => (b.fadeStrength ?? 0) - (a.fadeStrength ?? 0))
    const combos = []
    const used = new Set()
    while (combos.length < 3) {
      const picks = []
      const teamCounts = {}
      for (const p of byFade) {
        if (used.has(p.playerName)) continue
        const team = p.team || `__solo_${p.playerName}`
        if ((teamCounts[team] ?? 0) >= 2) continue
        picks.push(p)
        teamCounts[team] = (teamCounts[team] ?? 0) + 1
        if (picks.length === 6) break
      }
      if (picks.length < 6) break
      const teamSet = new Set(picks.map(p => p.team || `__solo_${p.playerName}`))
      if (teamSet.size < 4) break  // require at least 4 different teams
      picks.forEach(p => used.add(p.playerName))
      // Sort highest fade strength first within combo
      const sorted = [...picks].sort((a, b) => (b.fadeStrength ?? 0) - (a.fadeStrength ?? 0))
      const jointProb = sorted.reduce((acc, p) => acc * p.probability, 1)
      const ev = calcEV(Math.pow(jointProb, 1 / 6), 6, 0)
      combos.push({ picks: sorted, ev, jointProb, goblinCount: 0 })
    }
    return combos
  }, [underPool])

  const underCombos6 = useMemo(
    () => under6Raw.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [under6Raw, getStatLine, playerHistory],
  )

  // Ladder-dedicated 2-leg combo. Pulls from the same demon-free pool that
  // feeds the PRECISION 2-LEG cards. Takes the best available (no minimum
  // floor) — only returns null when nothing clears 40% joint prob.
  const ladderSlip = useMemo(() => {
    const noDemons = resolvedSlipPool.filter(p => p.oddsType !== 'demon')
    if (noDemons.length < 2) return null
    const combos = bestCombos(noDemons, 2, 10)
    const withMeta = combos.map(c => ({
      ...withOverUnder(c, getStatLine),
      confidence: calcConfidence(c, getStatLine, playerHistory),
    }))
    const sorted = withMeta.sort((a, b) => {
      const ag = a.goblinCount === 0 ? 0 : 1
      const bg = b.goblinCount === 0 ? 0 : 1
      if (ag !== bg) return ag - bg
      return b.jointProb - a.jointProb
    })
    const best = sorted[0] ?? null
    return best && best.jointProb >= 0.40 ? best : null
  }, [resolvedSlipPool, getStatLine, playerHistory])

  const hasUnderSlips = underCombos2.length > 0 || underCombos3.length > 0 || underCombos4.length > 0
  const hasSlips = combos2.length > 0 || combos3.length > 0 || combos4.length > 0 || lotterySlip || hasUnderSlips || underCombos6.length > 0


  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--cream)', fontFamily: 'system-ui, sans-serif' }}>
      <ErrorBoundary label="Quote failed">
        <DailyQuote />
      </ErrorBoundary>

      <header style={{
        background: '#181818', borderBottom: '1px solid #2a2a2a',
        padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>
          PP <span style={{ color: 'var(--green)' }}>Esports</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: '#666' }}>
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: loading ? '#333' : '#2a2a2a', border: '1px solid #3a3a3a',
              color: 'var(--cream)', borderRadius: 6, padding: '6px 12px',
              fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '...' : '↺'}
          </button>
        </div>
      </header>

      {/* ── Top-level tab bar ── */}
      <div style={{
        background: '#181818', borderBottom: '1px solid #2a2a2a',
        display: 'flex', gap: 0,
      }}>
        {[{ id: 'slips', label: 'Slips' }, { id: 'results', label: 'Results' }, { id: 'ladder', label: '★ Ladder' }].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px', background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--green)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--green)' : '#666',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Ladder tab ── */}
      {activeTab === 'ladder' && (
        <LadderChallenge todaySlip={ladderSlip} />
      )}

      {/* ── Results tab ── */}
      {activeTab === 'results' && (
        <ResultsPage
          trackedSlips={trackedSlips}
          setResult={setResult}
        />
      )}

      {/* ── Slips tab ── */}
      {activeTab === 'slips' && (
        <>
          {/* League filter */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {LEAGUES.map(l => (
              <button
                key={l}
                onClick={() => setLeague(l)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: league === l ? 'var(--green)' : '#333',
                  background: league === l ? '#22c55e22' : '#1e1e1e',
                  color: league === l ? 'var(--green)' : '#aaa',
                }}
              >
                {l}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}>
              {filtered.length} props
            </span>
          </div>

          {error && (
            <div style={{ margin: 16, padding: 12, background: '#2a1111', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 12, color: '#fca5a5' }}>
              {error}
            </div>
          )}

          <div style={{ padding: '16px' }}>
            <p style={{ margin: '0 0 14px', fontSize: 11, color: '#555', lineHeight: 1.5 }}>
              Standard props form the foundation of every slip. Goblins are bonus picks — max 1 per 2/3-leg, max 2 per 4/6-leg. No player appears more than twice across all slips.
            </p>

            {/* ── Top Picks Today ── */}
            {topPicks.length > 0 && (
              <ErrorBoundary label="Top picks error">
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 10 }}>
                    TOP PICKS TODAY
                  </div>
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                    {topPicks.map(p => {
                      const lock   = isLock(p.line, p.statType)
                      const goblin = !lock && isGoblin(p)
                      const demon  = p.oddsType === 'demon'
                      const badge  = lock   ? { label: 'LOCK',   bg: '#1d4ed822', color: '#60a5fa', border: '#1d4ed855' }
                                   : goblin ? { label: 'GOBLIN', bg: '#16a34a22', color: '#16a34a', border: '#16a34a55' }
                                   : demon  ? { label: 'DEMON',  bg: '#6b21a822', color: '#a78bfa', border: '#6b21a855' }
                                   : null
                      const sl = getStatLine(p.playerName, p.league, p.statType)
                      const l5 = sl?.last5Avg ?? sl?.seasonAvg
                      const { overUnder, probability: displayProb, sharp: isSharp } =
                        resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
                      // Format avg display: abbreviate stat unit (K=Kills, D=Deaths, A=Assists, H=Hits)
                      const STAT_ABBR = { Kills: 'K', Deaths: 'D', Assists: 'A', Hits: 'H' }
                      const unit = STAT_ABBR[p.statType] || ''
                      const avgLabel = l5 != null ? `Avg: ${l5.toFixed(1)}${unit}` : null
                      return (
                        <div key={p.id} style={{
                          background: '#1e1e1e', border: `1px solid ${isSharp ? '#eab30840' : '#2a2a2a'}`, borderRadius: 8,
                          padding: '10px 14px', minWidth: 130, flexShrink: 0,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                            {badge && (
                              <span style={{
                                fontSize: 8, background: badge.bg, color: badge.color,
                                border: `1px solid ${badge.border}`, borderRadius: 3,
                                padding: '1px 4px', fontWeight: 700, letterSpacing: 0.3,
                              }}>{badge.label}</span>
                            )}
                            {p.sharpValue && (
                              <span style={{
                                fontSize: 8, fontWeight: 700,
                                background: '#22c55e14', color: '#22c55e',
                                border: '1px solid #22c55e40', borderRadius: 3, padding: '1px 4px',
                              }}>SHARP VALUE</span>
                            )}
                            {!p.sharpValue && isSharp && (
                              <span style={{
                                fontSize: 8, fontWeight: 700,
                                background: '#eab30814', color: '#eab308',
                                border: '1px solid #eab30840', borderRadius: 3, padding: '1px 4px',
                              }}>SHARP</span>
                            )}
                            <span style={{ fontSize: 9, color: '#555' }}>{p.league}</span>
                            <span style={{
                              fontSize: 8, fontWeight: 700,
                              background: overUnder === 'OVER' ? '#22c55e14' : '#ef444414',
                              color: overUnder === 'OVER' ? '#22c55e' : '#ef4444',
                              border: `1px solid ${overUnder === 'OVER' ? '#22c55e40' : '#ef444440'}`,
                              borderRadius: 3, padding: '1px 4px',
                            }}>{overUnder}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cream)', marginBottom: 2 }}>
                            {p.playerName}
                          </div>
                          <div style={{ fontSize: 10, color: '#666', marginBottom: avgLabel ? 2 : 6 }}>
                            {p.statType} O{p.line}
                          </div>
                          {avgLabel && (
                            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>
                              {avgLabel} · Line: O{p.line}
                            </div>
                          )}
                          {p.marketLines && (
                            <div style={{ fontSize: 9, color: p.sharpValue ? '#22c55e' : '#666', marginBottom: 6, fontWeight: p.sharpValue ? 700 : 400 }}>
                              PP: O{p.line}
                              {p.marketLines.dk != null && ` · DK: O${p.marketLines.dk}`}
                              {p.marketLines.fd != null && ` · FD: O${p.marketLines.fd}`}
                            </div>
                          )}
                          <div style={{ fontSize: 20, fontWeight: 800, color: probColor(displayProb) }}>
                            {fmtPct(displayProb)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* ── Slip sections ── */}
            {hasSlips && (
              <ErrorBoundary label="Slip cards error">
                {/* Hero: Core 4-Leg */}
                {combos4.length > 0 && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 800, color: '#c9a84c', letterSpacing: 1, marginBottom: 12,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      ★ CORE 4-LEG
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: '#888', background: '#2a2a1a',
                        border: '1px solid #444', borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5,
                      }}>FLAGSHIP</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                      {combos4.map((c, i) => (
                        <SlipCard key={i} combo={c} rank={i + 1} variant="core4" confidence={c.confidence}
                          onTrack={() => addSlip(c, 'Core 4-Leg', league)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Two-column: Precision 2-Leg | Edge 3-Leg */}
                {(combos2.length > 0 || combos3.length > 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', marginBottom: 32 }}>
                    <div>
                      {combos2.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>
                            PRECISION 2-LEG
                          </div>
                          {combos2.map((c, i) => (
                            <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                              onTrack={() => addSlip(c, 'Precision 2-Leg', league)} />
                          ))}
                        </>
                      )}
                    </div>
                    <div>
                      {combos3.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>
                            EDGE 3-LEG
                          </div>
                          {combos3.map((c, i) => (
                            <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                              onTrack={() => addSlip(c, 'Edge 3-Leg', league)} />
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Under Parlay — lines ≥20% above typical, formula-based underProb */}
                {hasUnderSlips && (
                  <div style={{
                    marginBottom: 32,
                    background: '#1a0a0a', border: '1px solid #ef444440',
                    borderRadius: 10, padding: '16px 16px 12px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 13, fontWeight: 800, color: '#ef4444',
                      letterSpacing: 1, marginBottom: 4,
                    }}>
                      ↓ UNDER PARLAY
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: '#888', background: '#2a1010',
                        border: '1px solid #ef444433', borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5,
                      }}>FADE THE LINE</span>
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: 10, color: '#555', fontStyle: 'italic' }}>
                      Lines set ≥20% above typical average. Two 65%+ fades = 42%+ joint at 3× payout — positive EV.
                    </p>

                    {/* Primary: 2-leg under — best risk/reward */}
                    {underCombos2.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                          fontSize: 10, fontWeight: 800, color: '#ef4444', letterSpacing: 1,
                        }}>
                          PRIMARY FADE
                          <span style={{
                            fontSize: 9, color: '#888', background: '#2a1010',
                            border: '1px solid #ef444433', borderRadius: 4, padding: '1px 6px',
                          }}>2-LEG · BEST EV</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                          {underCombos2.map((c, i) => (
                            <SlipCard key={`u2-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                              label="UNDERS 2-LEG" onTrack={() => addSlip(c, 'Under Parlay 2-Leg', league)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Higher risk: 3-leg */}
                    {underCombos3.length > 0 && (
                      <div style={{ marginBottom: 20 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                          fontSize: 10, fontWeight: 700, color: '#ef444488', letterSpacing: 1,
                        }}>
                          HIGHER RISK
                          <span style={{
                            fontSize: 9, color: '#666', background: '#1f1010',
                            border: '1px solid #ef444422', borderRadius: 4, padding: '1px 6px',
                          }}>3-LEG</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                          {underCombos3.map((c, i) => (
                            <SlipCard key={`u3-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                              label="UNDERS 3-LEG" onTrack={() => addSlip(c, 'Under Parlay 3-Leg', league)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Higher risk: 4-leg */}
                    {underCombos4.length > 0 && (
                      <div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                          fontSize: 10, fontWeight: 700, color: '#ef444466', letterSpacing: 1,
                        }}>
                          HIGHER RISK
                          <span style={{
                            fontSize: 9, color: '#555', background: '#1a0f0f',
                            border: '1px solid #ef444418', borderRadius: 4, padding: '1px 6px',
                          }}>4-LEG</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                          {underCombos4.map((c, i) => (
                            <SlipCard key={`u4-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                              label="UNDERS 4-LEG" onTrack={() => addSlip(c, 'Under Parlay 4-Leg', league)} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Unders 6-Leg — esports only, sorted by fade strength */}
                {underCombos6.length > 0 && (
                  <div style={{
                    marginBottom: 32,
                    background: '#100a1a', border: '1px solid #7c3aed40',
                    borderRadius: 10, padding: '16px 16px 12px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 13, fontWeight: 800, color: '#a78bfa',
                      letterSpacing: 1, marginBottom: 4,
                    }}>
                      ↓ UNDERS 6-LEG
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: '#888', background: '#1a1025',
                        border: '1px solid #7c3aed33', borderRadius: 4, padding: '2px 6px', letterSpacing: 0.5,
                      }}>FADE</span>
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: 10, color: '#555', fontStyle: 'italic' }}>
                      Esports props with highest fade strength — lines furthest above typical avg, sorted by fade %.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                      {underCombos6.map((c, i) => (
                        <SlipCard key={`u6-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                          label="UNDERS 6-LEG"
                          onTrack={() => addSlip(c, 'Unders 6-Leg', league)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Lottery 6-Leg */}
                {lotterySlip && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', letterSpacing: 1, marginBottom: 8 }}>
                      LOTTERY 6-LEG
                    </div>
                    <SlipCard combo={lotterySlip} rank={1} variant="lottery" confidence={lotterySlip.confidence}
                      onTrack={() => addSlip(lotterySlip, 'Lottery 6-Leg', 'ALL')} />
                  </div>
                )}
              </ErrorBoundary>
            )}

            {/* ── All Projections table ── */}
            <ErrorBoundary label="Projections table error">
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 4, marginTop: 32 }}>
                ALL PROJECTIONS
              </div>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 10 }}>
                Showing top {Math.min(50, sorted.length)} of {sorted.length} props
              </div>
              {loading && !projections.length ? (
                <div style={{ color: '#555', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading...</div>
              ) : sorted.length === 0 ? (
                <div style={{ color: '#555', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
                  {league === 'MLB'
                    ? 'No MLB props available right now. PrizePicks typically posts MLB props 2–3 hours before first pitch.'
                    : 'No props available right now.'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                        {['Player', 'Team', 'Opponent', 'League', 'Stat', 'Line', 'Rec', 'Stats', 'Hit Prob', '2-Leg EV', '4-Leg EV'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600, fontSize: 10, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.slice(0, 50).map(p => {
                        const ppGoblin = p.oddsType === 'goblin'
                        const goblinDisplay = isGoblin(p)
                        const sl = getStatLine(p.playerName, p.league, p.statType)
                        const { overUnder, probability: displayProb, sharp: propSharp } =
                          resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
                        const ev2 = calcEV(displayProb, 2, ppGoblin ? 1 : 0)
                        const ev4 = calcEV(displayProb, 4, ppGoblin ? 1 : 0)
                        const hasHistory = playerHistory[p.playerName]
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid #1f1f1f' }}>
                            <td style={{ padding: '9px 10px', color: 'var(--cream)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {p.playerName}
                              {ppGoblin && (
                                <span style={{ marginLeft: 5, fontSize: 9, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b55', borderRadius: 3, padding: '1px 4px' }}>GOB</span>
                              )}
                              {hasHistory && (
                                <span style={{ marginLeft: 5, fontSize: 9, color: hasHistory.hits >= hasHistory.misses ? 'var(--green)' : 'var(--red)' }}>
                                  {hasHistory.hits}W {hasHistory.misses}L
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', color: '#888', whiteSpace: 'nowrap' }}>{p.team || '—'}</td>
                            <td style={{ padding: '9px 10px', color: '#666', fontSize: 10, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                              {p.opponent ? `vs ${p.opponent}` : '—'}
                            </td>
                            <td style={{ padding: '9px 10px', color: '#666', fontSize: 10 }}>{p.league}</td>
                            <td style={{ padding: '9px 10px', color: '#aaa', whiteSpace: 'nowrap' }}>{p.statType}</td>
                            <td style={{ padding: '9px 10px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {p.line}
                              {isLock(p.line, p.statType) ? (
                                <span style={{ marginLeft: 5, fontSize: 9, background: '#1d4ed822', color: '#60a5fa', border: '1px solid #1d4ed855', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>LOCK</span>
                              ) : goblinDisplay ? (
                                <span style={{ marginLeft: 5, fontSize: 9, background: '#16a34a22', color: '#16a34a', border: '1px solid #16a34a55', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>GOBLIN</span>
                              ) : null}
                            </td>
                            <td style={{ padding: '9px 10px' }}>
                              <span style={{
                                fontSize: 9, fontWeight: 700,
                                background: overUnder === 'OVER' ? '#22c55e14' : '#ef444414',
                                color: overUnder === 'OVER' ? '#22c55e' : '#ef4444',
                                border: `1px solid ${overUnder === 'OVER' ? '#22c55e40' : '#ef444440'}`,
                                borderRadius: 3, padding: '2px 5px',
                              }}>
                                {overUnder}
                              </span>
                              {p.sharpValue && (
                                <span style={{
                                  marginLeft: 4, fontSize: 9, fontWeight: 700,
                                  background: '#22c55e14', color: '#22c55e',
                                  border: '1px solid #22c55e40', borderRadius: 3, padding: '2px 4px',
                                }}>SHARP VALUE</span>
                              )}
                              {!p.sharpValue && propSharp && (
                                <span style={{
                                  marginLeft: 4, fontSize: 9, fontWeight: 700,
                                  background: '#eab30814', color: '#eab308',
                                  border: '1px solid #eab30840', borderRadius: 3, padding: '2px 4px',
                                }}>~</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                              {sl ? (
                                p.league === 'MLB' ? (
                                  <div style={{ fontSize: 10, lineHeight: 1.6 }}>
                                    {sl.last5Avg != null && (
                                      <div style={{ color: sl.last5Avg >= p.line ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                                        L5&nbsp;{sl.last5Avg.toFixed(1)}
                                      </div>
                                    )}
                                    {sl.seasonAvg != null && (
                                      <div style={{ color: '#888' }}>
                                        Szn&nbsp;{sl.seasonAvg.toFixed(1)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <StatsBadge seasonAvg={sl.seasonAvg} last5Avg={sl.last5Avg} line={p.line} />
                                )
                              ) : psLoading ? (
                                <span style={{ color: '#444', fontSize: 10 }}>…</span>
                              ) : null}
                              {p.marketLines && (
                                <div style={{ fontSize: 9, color: p.sharpValue ? '#22c55e' : '#666', marginTop: sl ? 4 : 0, fontWeight: p.sharpValue ? 700 : 400 }}>
                                  PP&nbsp;O{p.line}
                                  {p.marketLines.dk != null && <> · DK&nbsp;O{p.marketLines.dk}</>}
                                  {p.marketLines.fd != null && <> · FD&nbsp;O{p.marketLines.fd}</>}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px', fontWeight: 700, color: probColor(displayProb) }}>
                              {fmtPct(displayProb)}
                            </td>
                            <td style={{ padding: '9px 10px', color: ev2 >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtEV(ev2)}
                            </td>
                            <td style={{ padding: '9px 10px', color: ev4 >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtEV(ev4)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ErrorBoundary>

            <ErrorBoundary label="Slip tracker error">
              <SlipTracker
                trackedSlips={trackedSlips}
                setResult={setResult}
                setMissedLeg={setMissedLeg}
                removeSlip={removeSlip}
                playerHistory={playerHistory}
                wins={wins}
                losses={losses}
                pnl={pnl}
                winRate={winRate}
                settled={settled}
                pending={pending}
                supabaseLoading={supabaseLoading}
              />
            </ErrorBoundary>
          </div>
        </>
      )}
    </div>
  )
}
