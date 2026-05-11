import { useState, useMemo, useEffect, useRef } from 'react'
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

// Attach OVER/UNDER recommendation, adjusted probability, and sharp flag to every
// pick in a combo using resolveOverUnder (handles both stats-available and null cases).
function withOverUnder(combo, getStatLine) {
  return {
    ...combo,
    picks: combo.picks.map(p => {
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

  const filtered = useMemo(
    () => league === 'ALL' ? adjustedProjections : adjustedProjections.filter(p => inLeague(p, league)),
    [adjustedProjections, league],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.probability - a.probability),
    [filtered],
  )

  const slipPool = useMemo(() => {
    if (league === 'ALL') return scoredSort(adjustedProjections)
    const primary   = scoredSort(adjustedProjections.filter(p => inLeague(p, league)))
    const secondary = scoredSort(adjustedProjections.filter(p => !inLeague(p, league)))
    return [...primary, ...secondary]
  }, [adjustedProjections, league])

  const lotteryPool = useMemo(() => scoredSort(adjustedProjections), [adjustedProjections])

  // Under pool: pre-resolve each prop and keep only UNDER recommendations.
  // Probability is already direction-adjusted (P(UNDER hit) = 1-P(OVER)) so
  // bestCombos ranks by true UNDER probability without double-adjustment.
  const underPool = useMemo(() => {
    const resolved = adjustedProjections.map(p => {
      const sl = getStatLine(p.playerName, p.league, p.statType)
      const { overUnder, probability, sharp } = resolveOverUnder(sl, p.league, p.statType, p.line, p.probability)
      return { ...p, overUnder, probability, sharp }
    })
    return scoredSort(resolved.filter(p => p.overUnder === 'UNDER'))
  }, [adjustedProjections, getStatLine])

  const underRaw = useMemo(() => {
    if (underPool.length < 2) return { u2: [], u3: [], u4: [] }
    const appearances = {}
    const u4 = bestCombos(underPool, 4, 3, appearances)
    const u2 = bestCombos(underPool, 2, 3, appearances)
    const u3 = bestCombos(underPool, 3, 3, appearances)
    return { u2, u3, u4 }
  }, [underPool])

  // Top Picks: standards first, then goblins, then locks.
  // Cap at 2 picks with the same statType+line to avoid 5×"MAPS 1-2 Kills O1.5".
  const topPicks = useMemo(() => {
    const candidates = [
      ...slipPool.filter(p => !isLock(p.line, p.statType) && !isGoblin(p)),
      ...slipPool.filter(p => !isLock(p.line, p.statType) && isGoblin(p)),
      ...slipPool.filter(p => isLock(p.line, p.statType)),
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
    const c4      = bestCombos(slipPool, 4, 3, appearances)
    const c2      = bestCombos(slipPool, 2, 3, appearances)
    const c3      = bestCombos(slipPool, 3, 3, appearances)
    const lottery = bestCombos(lotteryPool, 6, 1, appearances)[0] ?? null
    return { c2, c3, c4, lottery }
  }, [slipPool, lotteryPool])

  // Attach confidence scores and OVER/UNDER to each combo's picks.
  const combos2 = useMemo(
    () => allRaw.c2.map(c => ({
      ...withOverUnder(c, getStatLine),
      confidence: calcConfidence(c, getStatLine, playerHistory),
    })),
    [allRaw.c2, getStatLine, playerHistory],
  )
  const combos3 = useMemo(
    () => allRaw.c3.map(c => ({
      ...withOverUnder(c, getStatLine),
      confidence: calcConfidence(c, getStatLine, playerHistory),
    })),
    [allRaw.c3, getStatLine, playerHistory],
  )
  const combos4 = useMemo(
    () => allRaw.c4.map(c => ({
      ...withOverUnder(c, getStatLine),
      confidence: calcConfidence(c, getStatLine, playerHistory),
    })),
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

  const hasUnderSlips = underCombos2.length > 0 || underCombos3.length > 0 || underCombos4.length > 0
  const hasSlips = combos2.length > 0 || combos3.length > 0 || combos4.length > 0 || lotterySlip || hasUnderSlips

  // Auto-save all generated slips once per session
  const autoSavedRef = useRef(false)
  useEffect(() => {
    if (autoSavedRef.current) return
    if (supabaseLoading) return
    if (!combos2.length && !combos3.length && !combos4.length && !lotterySlip) return

    autoSavedRef.current = true
    const existingIds = new Set(trackedSlips.map(s => s.id))

    function maybeAdd(combo, slipType, leagueArg) {
      const key = `${slipType}|${combo.picks.length}|${Number(combo.ev).toFixed(8)}|${Number(combo.jointProb).toFixed(8)}`
      if (!existingIds.has(key)) addSlip(combo, slipType, leagueArg)
    }

    combos2.forEach(c => maybeAdd(c, 'Precision 2-Leg', league))
    combos3.forEach(c => maybeAdd(c, 'Edge 3-Leg', league))
    combos4.forEach(c => maybeAdd(c, 'Core 4-Leg', league))
    if (lotterySlip) maybeAdd(lotterySlip, 'Lottery 6-Leg', 'ALL')
  }, [supabaseLoading, combos2, combos3, combos4, lotterySlip, trackedSlips, addSlip, league])

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
        {[{ id: 'slips', label: 'Slips' }, { id: 'ladder', label: '★ Ladder' }].map(tab => (
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
        <LadderChallenge todaySlip={combos2[0] ?? null} />
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
                            {isSharp && (
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
                            <div style={{ fontSize: 9, color: '#888', marginBottom: 6 }}>
                              {avgLabel} · Line: O{p.line}
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

                {/* Under Parlay — UNDER-only props, placed between Edge 3-Leg and Lottery */}
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
                    <p style={{ margin: '0 0 14px', fontSize: 10, color: '#555', fontStyle: 'italic' }}>
                      Props where the line sits above typical averages — bet the UNDER.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                      {underCombos4.map((c, i) => (
                        <SlipCard key={`u4-${i}`} combo={c} rank={i + 1} variant="core4" confidence={c.confidence}
                          onTrack={() => addSlip(c, 'Under Parlay 4-Leg', league)} />
                      ))}
                      {underCombos3.map((c, i) => (
                        <SlipCard key={`u3-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                          onTrack={() => addSlip(c, 'Under Parlay 3-Leg', league)} />
                      ))}
                      {underCombos2.map((c, i) => (
                        <SlipCard key={`u2-${i}`} combo={c} rank={i + 1} confidence={c.confidence}
                          onTrack={() => addSlip(c, 'Under Parlay 2-Leg', league)} />
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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 10, marginTop: 32 }}>
                ALL PROJECTIONS
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
                        {['Player', 'Team', 'League', 'Stat', 'Line', 'Rec', 'Stats', 'Hit Prob', '2-Leg EV', '4-Leg EV'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600, fontSize: 10, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(p => {
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
                              {propSharp && (
                                <span style={{
                                  marginLeft: 4, fontSize: 9, fontWeight: 700,
                                  background: '#eab30814', color: '#eab308',
                                  border: '1px solid #eab30840', borderRadius: 3, padding: '2px 4px',
                                }}>~</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 10px' }}>
                              {sl ? (
                                <StatsBadge seasonAvg={sl.seasonAvg} last5Avg={sl.last5Avg} line={p.line} />
                              ) : psLoading ? (
                                <span style={{ color: '#444', fontSize: 10 }}>…</span>
                              ) : null}
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
