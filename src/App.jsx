import { useState, useMemo } from 'react'
import { poissonOverProb, poissonUnderProb } from './utils/poisson.js'
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
// All values are per-map/per-game counts (NOT per-round rates).
// Multi-map variants scale by map count; ADR is a per-round rate so never scales.
function extractMaps(statType) {
  const s = (statType || '').toLowerCase();
  if (s.includes('1-3')) return 3;
  if (s.includes('1-2')) return 2;
  return 1;
}

function typicalAvg(league, statType, maps = 1) {
  const g  = (league || '').toUpperCase()
  const st = (statType || '').toLowerCase()
  if (g === 'MLB') return null
  const is12 = /1-2/i.test(st)
  const is13 = /1-3/i.test(st)
  if (st.includes('kill')) {
    if (g === 'CS2' || g === 'CSGO') return is13 ? 42 : is12 ? 28 : 16
    if (g === 'LOL')                  return is13 ? 18 : is12 ? 13 : 7
    if (g === 'VAL')                  return is13 ? 45 : is12 ? 32 : 18
    if (g === 'DOTA2')                return is13 ? 21 : is12 ? 16 : 8
  }
  if (st.includes('death')) {
    if (g === 'CS2' || g === 'CSGO') return is13 ? 36 : is12 ? 27 : 14
    if (g === 'LOL')                  return is13 ? 11 : is12 ? 8 : 4
    if (g === 'VAL')                  return is13 ? 39 : is12 ? 29 : 15
    if (g === 'DOTA2')                return is13 ? 18 : is12 ? 13 : 7
  }
  if (st.includes('assist')) {
    if (g === 'CS2' || g === 'CSGO') return is13 ? 10 : is12 ? 8 : 4
    if (g === 'LOL')                  return is13 ? 25 : is12 ? 20 : 10
    if (g === 'VAL')                  return is13 ? 16 : is12 ? 11 : 6
    if (g === 'DOTA2')                return is13 ? 31 : is12 ? 23 : 12
  }
  if (st.includes('headshot')) {
    if (g === 'CS2' || g === 'CSGO') return is13 ? 26 : is12 ? 18 : 10
  }
  if (st.includes('adr') || st.includes('damage per round')) {
    // ADR is already a per-round rate — does not scale with map count
    if (g === 'CS2' || g === 'CSGO') return 75
  }
  if (st.includes('last hit')) {
    if (g === 'DOTA2') return is12 ? 280 : 150
  }
  if (st === 'gpm' || st.includes('gold per min') || st.includes('gold/min')) {
    if (g === 'DOTA2') return 450
  }
  return null
}

// Resolve OVER/UNDER direction, probability, and sharp flag for a single prop.
// Uses Poisson distribution with lambda = player's L5 avg, season avg, or typical avg.
// Guard: PandaScore sometimes returns per-round rates (KPR ≈ 0.65) instead of
// per-map totals. If real data is < 35% of typical it's the wrong unit — use typical.
function resolveOverUnder(statLine, league, statType, line, currentProb) {
  const realLambda = statLine?.last5Avg ?? statLine?.seasonAvg
  const typical    = typicalAvg(league, statType, extractMaps(statType))

  let lambda
  if (realLambda != null && realLambda > 0) {
    if (typical == null || realLambda >= typical * 0.35) {
      lambda = realLambda
    } else {
      console.warn(`[poisson] real lambda=${realLambda.toFixed(2)} < 35% of typical=${typical} — likely per-round units, using typical`)
      lambda = typical
    }
  } else {
    lambda = typical
  }

  if (!lambda || lambda <= 0) {
    return { overUnder: 'OVER', probability: 0.55, sharp: false }
  }

  const overProb = poissonOverProb(lambda, line)
  const underProb = poissonUnderProb(lambda, line)
  const direction = overProb >= underProb ? 'OVER' : 'UNDER'
  const probability = direction === 'OVER' ? overProb : underProb
  const sharp = probability >= 0.72

  console.log(`[poisson] lambda=${lambda.toFixed(2)} line=${line} direction=${direction} probability=${probability.toFixed(3)}`)

  return { overUnder: direction, probability, sharp }
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
      const typical = typicalAvg(p.league, p.statType, extractMaps(p.statType))
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

  // Under pool: filtered by active league tab. fadeStrength is calculated from the
  // player's personal last5Avg/seasonAvg when available; falls back to population
  // typicalAvg only when PandaScore data hasn't loaded yet. getStatLine in the dep
  // array causes the pool to recompute automatically as per-player stats stream in.
  const underPool = useMemo(() => {
    const pool = league === 'ALL'
      ? esportsProjections
      : esportsProjections.filter(p => inLeague(p, league))
    const qualified = []
    for (const p of pool) {
      if (p.playerName.includes('+') || p.playerName.includes('&')) continue
      // Personal history takes precedence; population avg is the fallback.
      const sl         = getStatLine(p.playerName, p.league, p.statType)
      const playerAvg  = sl?.last5Avg ?? sl?.seasonAvg ?? null
      const baseline   = playerAvg ?? typicalAvg(p.league, p.statType, extractMaps(p.statType))
      if (baseline == null) continue
      const ratio = p.line / baseline
      if (ratio < 1.20) continue  // line must be ≥20% above player's actual output
      if (ratio > 3.00) { console.log(`[under] SKIP ratio too high "${p.playerName}" line=${p.line} baseline=${baseline.toFixed(1)} ratio=${ratio.toFixed(2)}`); continue }
      const underProb    = poissonUnderProb(baseline, p.line)
      const fadeStrength = Math.round((ratio - 1) * 100)
      console.log(`[under] "${p.playerName}" line=${p.line} baseline=${baseline.toFixed(1)}(${playerAvg != null ? 'personal' : 'typical'}) ratio=${ratio.toFixed(2)} → ${((ratio).toFixed(1))}x AVG`)
      qualified.push({ ...p, overUnder: 'UNDER', probability: underProb, sharp: false, fadeStrength })
    }
    return scoredSort(qualified)
  }, [esportsProjections, league, getStatLine])

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



  const LEAGUE_COLORS = {
    LOL: '#c89b3c', CS2: '#4ade80', CSGO: '#4ade80',
    VAL: '#f472b6', DOTA2: '#f97316', MLB: '#60a5fa',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--cream)' }}>
      <ErrorBoundary label="Quote failed">
        <DailyQuote />
      </ErrorBoundary>

      <header style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: 52, position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, lineHeight: 1 }}>
            <span style={{ color: 'var(--green)' }}>PP</span>
            <span style={{ color: '#3a3a3a', margin: '0 4px' }}>·</span>
            <span style={{ color: 'var(--cream)', fontSize: 14, fontWeight: 600, letterSpacing: 0 }}>Esports</span>
          </div>
          {psLoading && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              background: '#22c55e14', color: '#22c55e88', border: '1px solid #22c55e30',
              borderRadius: 4, padding: '2px 7px', animation: 'pulse-glow 1.5s ease-in-out infinite',
            }}>LOADING STATS</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && (
            <div style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </div>
          )}
          <button onClick={refresh} disabled={loading} style={{
            background: loading ? '#1a1a1a' : 'var(--surface2)',
            border: '1px solid var(--border2)', color: loading ? '#444' : 'var(--cream)',
            borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? '···' : '↺ Refresh'}
          </button>
        </div>
      </header>

      <nav style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        display: 'flex', gap: 0, paddingLeft: 20,
      }}>
        {[{ id: 'slips', label: 'Slips' }, { id: 'results', label: 'Results' }, { id: 'ladder', label: '★ Ladder' }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '12px 20px', background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--green)' : '2px solid transparent',
            color: activeTab === tab.id ? 'var(--green)' : 'var(--muted)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
          }}>{tab.label}</button>
        ))}
      </nav>

      {activeTab === 'ladder' && <LadderChallenge todaySlip={ladderSlip} />}
      {activeTab === 'results' && <ResultsPage trackedSlips={trackedSlips} setResult={setResult} />}

      {activeTab === 'slips' && (
        <div style={{ padding: '16px 20px 40px' }}>

          <div style={{
            display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
            marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)',
          }}>
            {LEAGUES.map(l => {
              const lc = LEAGUE_COLORS[l]
              const active = league === l
              return (
                <button key={l} onClick={() => setLeague(l)} style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', border: '1px solid', letterSpacing: 0.4,
                  borderColor: active ? (lc || 'var(--green)') : 'var(--border2)',
                  background: active ? `${lc || '#22c55e'}18` : 'var(--surface)',
                  color: active ? (lc || 'var(--green)') : 'var(--muted)',
                }}>{l}</button>
              )
            })}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>{filtered.length} props</span>
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#1f0a0a', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 12, color: '#fca5a5' }}>{error}</div>
          )}

          {topPicks.length > 0 && (
            <ErrorBoundary label="Top picks error">
              <section style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--muted)' }}>TOP PICKS TODAY</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                  {topPicks.map(p => {
                    const sl = getStatLine(p.playerName, p.league, p.statType)
                    const l5 = sl?.last5Avg ?? sl?.seasonAvg
                    const { overUnder, probability: displayProb, sharp: isSharp } =
                      resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
                    const isOver = overUnder === 'OVER'
                    const lc = LEAGUE_COLORS[p.league] || '#888'
                    return (
                      <div key={p.id} style={{
                        background: 'var(--surface)',
                        border: `1px solid ${p.sharpValue ? '#22c55e40' : isSharp ? '#eab30840' : 'var(--border)'}`,
                        borderRadius: 10, padding: '12px 14px', minWidth: 140, flexShrink: 0,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
                          <span style={{ fontSize: 8, fontWeight: 800, color: lc, background: `${lc}18`, border: `1px solid ${lc}50`, borderRadius: 3, padding: '1px 5px' }}>{p.league}</span>
                          {p.sharpValue && <span style={{ fontSize: 8, fontWeight: 700, color: '#22c55e', background: '#22c55e14', border: '1px solid #22c55e40', borderRadius: 3, padding: '1px 4px' }}>SHARP VALUE</span>}
                          {!p.sharpValue && isSharp && <span style={{ fontSize: 8, fontWeight: 700, color: '#eab308', background: '#eab30814', border: '1px solid #eab30840', borderRadius: 3, padding: '1px 4px' }}>SHARP</span>}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cream)', marginBottom: 2 }}>{p.playerName}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>{p.statType} · O{p.line}</div>
                        {l5 != null && <div style={{ fontSize: 9, color: '#555', marginBottom: 6 }}>Avg {l5.toFixed(1)}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '2px 5px', background: isOver ? '#22c55e18' : '#ef444418', color: isOver ? 'var(--green)' : 'var(--red)', border: `1px solid ${isOver ? '#22c55e40' : '#ef444440'}` }}>{overUnder}</span>
                          <span style={{ fontSize: 16, fontWeight: 800, color: probColor(displayProb) }}>{fmtPct(displayProb)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </ErrorBoundary>
          )}

          {hasSlips && (
            <ErrorBoundary label="Slip cards error">
              {combos4.length > 0 && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--gold)' }}>★ CORE 4-LEG</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 4, padding: '2px 6px' }}>FLAGSHIP</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                    {combos4.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} variant="core4" confidence={c.confidence} onTrack={() => addSlip(c, 'Core 4-Leg', league)} />)}
                  </div>
                </section>
              )}

              {(combos2.length > 0 || combos3.length > 0) && (
                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28, alignItems: 'start' }}>
                  <div>
                    {combos2.length > 0 && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--muted)' }}>PRECISION 2-LEG</span>
                          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        </div>
                        {combos2.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence} onTrack={() => addSlip(c, 'Precision 2-Leg', league)} />)}
                      </>
                    )}
                  </div>
                  <div>
                    {combos3.length > 0 && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--muted)' }}>EDGE 3-LEG</span>
                          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        </div>
                        {combos3.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence} onTrack={() => addSlip(c, 'Edge 3-Leg', league)} />)}
                      </>
                    )}
                  </div>
                </section>
              )}

              {hasUnderSlips && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: '#ef4444' }}>↓ UNDER PARLAY</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: '#ef444488', background: '#ef444410', border: '1px solid #ef444430', borderRadius: 4, padding: '2px 6px' }}>FADE THE LINE</span>
                    <div style={{ flex: 1, height: 1, background: '#ef444420' }} />
                  </div>
                  <p style={{ margin: '0 0 14px', fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>Lines set ≥20% above typical average. Two 65%+ fades = 42%+ joint at 3× payout — positive EV.</p>
                  {underCombos2.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#ef444488', letterSpacing: 1, marginBottom: 8 }}>2-LEG · BEST EV</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                        {underCombos2.map((c, i) => <SlipCard key={`u2-${i}`} combo={c} rank={i + 1} confidence={c.confidence} label="UNDERS 2-LEG" onTrack={() => addSlip(c, 'Under Parlay 2-Leg', league)} />)}
                      </div>
                    </div>
                  )}
                  {underCombos3.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#ef444455', letterSpacing: 1, marginBottom: 8 }}>3-LEG</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                        {underCombos3.map((c, i) => <SlipCard key={`u3-${i}`} combo={c} rank={i + 1} confidence={c.confidence} label="UNDERS 3-LEG" onTrack={() => addSlip(c, 'Under Parlay 3-Leg', league)} />)}
                      </div>
                    </div>
                  )}
                  {underCombos4.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#ef444433', letterSpacing: 1, marginBottom: 8 }}>4-LEG</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                        {underCombos4.map((c, i) => <SlipCard key={`u4-${i}`} combo={c} rank={i + 1} confidence={c.confidence} label="UNDERS 4-LEG" onTrack={() => addSlip(c, 'Under Parlay 4-Leg', league)} />)}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {underCombos6.length > 0 && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: '#a78bfa' }}>↓ UNDERS 6-LEG</span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: '#a78bfa88', background: '#a78bfa10', border: '1px solid #a78bfa30', borderRadius: 4, padding: '2px 6px' }}>FADE</span>
                    <div style={{ flex: 1, height: 1, background: '#a78bfa20' }} />
                  </div>
                  <p style={{ margin: '0 0 14px', fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>Highest fade strength props — lines furthest above typical avg, sorted by fade %.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                    {underCombos6.map((c, i) => <SlipCard key={`u6-${i}`} combo={c} rank={i + 1} confidence={c.confidence} label="UNDERS 6-LEG" onTrack={() => addSlip(c, 'Unders 6-Leg', league)} />)}
                  </div>
                </section>
              )}

              {lotterySlip && (
                <section style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--gold)' }}>LOTTERY 6-LEG</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <SlipCard combo={lotterySlip} rank={1} variant="lottery" confidence={lotterySlip.confidence} onTrack={() => addSlip(lotterySlip, 'Lottery 6-Leg', 'ALL')} />
                </section>
              )}
            </ErrorBoundary>
          )}

          <ErrorBoundary label="Projections table error">
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--muted)' }}>ALL PROJECTIONS</span>
                <span style={{ fontSize: 10, color: '#444' }}>top {Math.min(50, sorted.length)} of {sorted.length}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              {loading && !projections.length ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}>Loading props…</div>
              ) : sorted.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '48px 0', textAlign: 'center' }}>
                  {league === 'MLB' ? 'No MLB props right now. PrizePicks typically posts 2–3h before first pitch.' : 'No props available right now.'}
                </div>
              ) : (
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border2)' }}>
                        {['Player', 'Team', 'Opp', 'League', 'Stat', 'Line', 'Rec', 'Stats', 'Prob', '2-Leg EV', '4-Leg EV'].map(h => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: 'left', color: 'var(--muted)', fontWeight: 700, fontSize: 9, letterSpacing: 0.8, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.slice(0, 50).map((p, idx) => {
                        const ppGoblin = p.oddsType === 'goblin'
                        const goblinDisplay = isGoblin(p)
                        const sl = getStatLine(p.playerName, p.league, p.statType)
                        const { overUnder, probability: displayProb, sharp: propSharp } =
                          resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
                        const ev2 = calcEV(displayProb, 2, ppGoblin ? 1 : 0)
                        const ev4 = calcEV(displayProb, 4, ppGoblin ? 1 : 0)
                        const hasHistory = playerHistory[p.playerName]
                        const lc = LEAGUE_COLORS[p.league] || '#888'
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: idx % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                            <td style={{ padding: '8px 12px', color: 'var(--cream)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {p.playerName}
                              {ppGoblin && <span style={{ marginLeft: 5, fontSize: 8, background: '#f59e0b18', color: '#f59e0b', border: '1px solid #f59e0b44', borderRadius: 3, padding: '1px 4px' }}>GOB</span>}
                              {hasHistory && <span style={{ marginLeft: 5, fontSize: 9, color: hasHistory.hits >= hasHistory.misses ? 'var(--green)' : 'var(--red)' }}>{hasHistory.hits}W {hasHistory.misses}L</span>}
                            </td>
                            <td style={{ padding: '8px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{p.team || '—'}</td>
                            <td style={{ padding: '8px 12px', color: '#555', fontSize: 10, fontStyle: 'italic', whiteSpace: 'nowrap' }}>{p.opponent ? `vs ${p.opponent}` : '—'}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.5, color: lc, background: `${lc}18`, border: `1px solid ${lc}44`, borderRadius: 3, padding: '1px 5px' }}>{p.league}</span>
                            </td>
                            <td style={{ padding: '8px 12px', color: '#aaa', whiteSpace: 'nowrap' }}>{p.statType}</td>
                            <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {p.line}
                              {isLock(p.line, p.statType) ? <span style={{ marginLeft: 4, fontSize: 8, background: '#1d4ed818', color: '#60a5fa', border: '1px solid #1d4ed844', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>LOCK</span>
                              : goblinDisplay ? <span style={{ marginLeft: 4, fontSize: 8, background: '#16a34a18', color: '#16a34a', border: '1px solid #16a34a44', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>GOBLIN</span>
                              : null}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '2px 5px', background: overUnder === 'OVER' ? '#22c55e18' : '#ef444418', color: overUnder === 'OVER' ? 'var(--green)' : 'var(--red)', border: `1px solid ${overUnder === 'OVER' ? '#22c55e40' : '#ef444440'}` }}>{overUnder}</span>
                              {p.sharpValue && <span style={{ marginLeft: 3, fontSize: 8, fontWeight: 700, background: '#22c55e14', color: 'var(--green)', border: '1px solid #22c55e40', borderRadius: 3, padding: '1px 4px' }}>SV</span>}
                              {!p.sharpValue && propSharp && <span style={{ marginLeft: 3, fontSize: 9, color: '#eab30888' }}>~</span>}
                            </td>
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                              {sl ? (
                                p.league === 'MLB' ? (
                                  <div style={{ fontSize: 10, lineHeight: 1.6 }}>
                                    {sl.last5Avg != null && <div style={{ color: sl.last5Avg >= p.line ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>L5 {sl.last5Avg.toFixed(1)}</div>}
                                    {sl.seasonAvg != null && <div style={{ color: 'var(--muted)' }}>Szn {sl.seasonAvg.toFixed(1)}</div>}
                                  </div>
                                ) : <StatsBadge seasonAvg={sl.seasonAvg} last5Avg={sl.last5Avg} line={p.line} />
                              ) : psLoading ? <span style={{ color: '#333', fontSize: 10 }}>…</span> : null}
                              {p.marketLines && (
                                <div style={{ fontSize: 8, color: p.sharpValue ? 'var(--green)' : '#555', marginTop: sl ? 3 : 0, fontWeight: p.sharpValue ? 700 : 400 }}>
                                  PP O{p.line}{p.marketLines.dk != null && <> · DK O{p.marketLines.dk}</>}{p.marketLines.fd != null && <> · FD O{p.marketLines.fd}</>}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 700, color: probColor(displayProb) }}>{fmtPct(displayProb)}</td>
                            <td style={{ padding: '8px 12px', color: ev2 >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{fmtEV(ev2)}</td>
                            <td style={{ padding: '8px 12px', color: ev4 >= 0 ? 'var(--green)' : 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{fmtEV(ev4)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </ErrorBoundary>

          <ErrorBoundary label="Slip tracker error">
            <SlipTracker
              trackedSlips={trackedSlips} setResult={setResult} setMissedLeg={setMissedLeg}
              removeSlip={removeSlip} playerHistory={playerHistory}
              wins={wins} losses={losses} pnl={pnl} winRate={winRate}
              settled={settled} pending={pending} supabaseLoading={supabaseLoading}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
// force rebuild Wed May 20 2026