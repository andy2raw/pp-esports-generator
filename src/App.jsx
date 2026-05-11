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

const LEAGUES = ['ALL', 'LOL', 'CSGO', 'VAL', 'DOTA2']

function scoredSort(arr) {
  return [...arr].sort((a, b) => b.probability - a.probability)
}

export default function App() {
  const [league, setLeague] = useState('ALL')
  const { projections, loading, error, lastRefresh, countdown, refresh } = usePrizePicks()
  const { getStatLine, getCalcProb, psLoading } = usePandaScore(projections)
  const {
    trackedSlips, addSlip, setResult, setMissedLeg, removeSlip,
    playerHistory, playerScores, wins, losses, pnl, winRate, settled, pending,
    supabaseLoading,
  } = useSlipTracker()

  const adjustedProjections = useMemo(
    () => projections.map(p => {
      const serverProb = getCalcProb(p.playerName, p.league, p.statType)
      const prob = serverProb ?? p.probability
      console.log(`[winProb] ${p.league} ${p.playerName} | ${p.statType} | line=${p.line} | server=${serverProb?.toFixed(3) ?? 'null'} | base=${p.probability?.toFixed(3)} | used=${prob?.toFixed(3)}`)
      return { ...p, probability: prob }
    }),
    [projections, getCalcProb],
  )

  const filtered = useMemo(
    () => league === 'ALL' ? adjustedProjections : adjustedProjections.filter(p => p.league === league),
    [adjustedProjections, league],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.probability - a.probability),
    [filtered],
  )

  const slipPool = useMemo(() => {
    if (league === 'ALL') return scoredSort(adjustedProjections)
    const primary   = scoredSort(adjustedProjections.filter(p => p.league === league))
    const secondary = scoredSort(adjustedProjections.filter(p => p.league !== league))
    return [...primary, ...secondary]
  }, [adjustedProjections, league])

  const lotteryPool = useMemo(
    () => scoredSort(adjustedProjections),
    [adjustedProjections],
  )

  // Top Picks: 3 best standard props, then 2 goblins, then 1 lock.
  const topPicks = useMemo(() => {
    const standards = slipPool.filter(p =>
      !isLock(p.line, p.statType) && !isGoblin(p),
    ).slice(0, 3)
    const goblins   = slipPool.filter(p =>
      !isLock(p.line, p.statType) && isGoblin(p),
    ).slice(0, 2)
    const locks     = slipPool.filter(p => isLock(p.line, p.statType)).slice(0, 1)
    return [...standards, ...goblins, ...locks].slice(0, 6)
  }, [slipPool])

  const combos2Raw     = useMemo(() => bestCombos(slipPool, 2, 3),       [slipPool])
  const combos3Raw     = useMemo(() => bestCombos(slipPool, 3, 3),       [slipPool])
  const combos4Raw     = useMemo(() => bestCombos(slipPool, 4, 3),       [slipPool])
  const lotterySlipRaw = useMemo(() => bestCombos(lotteryPool, 6, 1)[0] ?? null, [lotteryPool])

  const combos2 = useMemo(
    () => combos2Raw.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [combos2Raw, getStatLine, playerHistory],
  )
  const combos3 = useMemo(
    () => combos3Raw.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [combos3Raw, getStatLine, playerHistory],
  )
  const combos4 = useMemo(
    () => combos4Raw.map(c => ({ ...c, confidence: calcConfidence(c, getStatLine, playerHistory) })),
    [combos4Raw, getStatLine, playerHistory],
  )
  const lotterySlip = useMemo(
    () => lotterySlipRaw
      ? { ...lotterySlipRaw, confidence: calcConfidence(lotterySlipRaw, getStatLine, playerHistory) }
      : null,
    [lotterySlipRaw, getStatLine, playerHistory],
  )

  const hasSlips = combos2.length > 0 || combos3.length > 0 || combos4.length > 0 || lotterySlip

  // Auto-save all generated slips once per session after data is ready.
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
          Standard props form the foundation of every slip. Goblins are bonus picks — max 1 per 2/3-leg, max 2 per 4/6-leg.
        </p>

        {/* ── Top Picks Today ─────────────────────────────────────────── */}
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
                  const badge  = lock   ? { label: 'LOCK',  bg: '#1d4ed822', color: '#60a5fa', border: '#1d4ed855' }
                               : goblin ? { label: 'GOBLIN', bg: '#16a34a22', color: '#16a34a', border: '#16a34a55' }
                               : demon  ? { label: 'DEMON',  bg: '#6b21a822', color: '#a78bfa', border: '#6b21a855' }
                               : null
                  return (
                    <div key={p.id} style={{
                      background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
                      padding: '10px 14px', minWidth: 120, flexShrink: 0,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                        {badge && (
                          <span style={{
                            fontSize: 8, background: badge.bg, color: badge.color,
                            border: `1px solid ${badge.border}`, borderRadius: 3,
                            padding: '1px 4px', fontWeight: 700, letterSpacing: 0.3,
                          }}>{badge.label}</span>
                        )}
                        <span style={{ fontSize: 9, color: '#555' }}>{p.league}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cream)', marginBottom: 2 }}>
                        {p.playerName}
                      </div>
                      <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
                        {p.statType} O{p.line}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: probColor(p.probability) }}>
                        {fmtPct(p.probability)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </ErrorBoundary>
        )}

        {/* ── Slip sections ───────────────────────────────────────────── */}
        {hasSlips && (
          <ErrorBoundary label="Slip cards error">

            {/* Hero: Core 4-Leg (flagship) */}
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

            {/* Two-column: left (Precision 2-Leg + Edge 3-Leg), right (Lottery 6-Leg) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
              {/* Left column */}
              <div>
                {combos2.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>
                      PRECISION 2-LEG
                    </div>
                    {combos2.map((c, i) => (
                      <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                        onTrack={() => addSlip(c, 'Precision 2-Leg', league)} />
                    ))}
                  </div>
                )}
                {combos3.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>
                      EDGE 3-LEG
                    </div>
                    {combos3.map((c, i) => (
                      <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                        onTrack={() => addSlip(c, 'Edge 3-Leg', league)} />
                    ))}
                  </div>
                )}
              </div>

              {/* Right column: Lottery 6-Leg */}
              <div>
                {lotterySlip && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', letterSpacing: 1, marginBottom: 8 }}>
                      LOTTERY 6-LEG
                    </div>
                    <SlipCard combo={lotterySlip} rank={1} variant="lottery" confidence={lotterySlip.confidence}
                      onTrack={() => addSlip(lotterySlip, 'Lottery 6-Leg', 'ALL')} />
                  </div>
                )}
              </div>
            </div>
          </ErrorBoundary>
        )}

        {/* ── All Projections table ────────────────────────────────────── */}
        <ErrorBoundary label="Projections table error">
          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 10, marginTop: 32 }}>
            ALL PROJECTIONS
          </div>
          {loading && !projections.length ? (
            <div style={{ color: '#555', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading...</div>
          ) : sorted.length === 0 ? (
            <div style={{ color: '#555', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
              No esports props available right now.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                    {['Player', 'Team', 'League', 'Stat', 'Line', 'Stats', 'Hit Prob', '2-Leg EV', '4-Leg EV'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#555', fontWeight: 600, fontSize: 10, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(p => {
                    const ppGoblin  = p.oddsType === 'goblin'  // for EV multiplier (PrizePicks designation)
                    const goblinDisplay = isGoblin(p)
                    const ev2 = calcEV(p.probability, 2, ppGoblin ? 1 : 0)
                    const ev4 = calcEV(p.probability, 4, ppGoblin ? 1 : 0)
                    const sl = getStatLine(p.playerName, p.league, p.statType)
                    const hasHistory = playerHistory[p.playerName]
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #1f1f1f' }}>
                        <td style={{ padding: '9px 10px', color: 'var(--cream)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {p.playerName}
                          {ppGoblin && (
                            <span style={{
                              marginLeft: 5, fontSize: 9, background: '#f59e0b22', color: '#f59e0b',
                              border: '1px solid #f59e0b55', borderRadius: 3, padding: '1px 4px',
                            }}>GOB</span>
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
                            <span style={{
                              marginLeft: 5, fontSize: 9, background: '#1d4ed822', color: '#60a5fa',
                              border: '1px solid #1d4ed855', borderRadius: 3, padding: '1px 4px', fontWeight: 700,
                            }}>LOCK</span>
                          ) : goblinDisplay ? (
                            <span style={{
                              marginLeft: 5, fontSize: 9, background: '#16a34a22', color: '#16a34a',
                              border: '1px solid #16a34a55', borderRadius: 3, padding: '1px 4px', fontWeight: 700,
                            }}>GOBLIN</span>
                          ) : null}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          {sl ? (
                            <StatsBadge seasonAvg={sl.seasonAvg} last5Avg={sl.last5Avg} line={p.line} />
                          ) : psLoading ? (
                            <span style={{ color: '#444', fontSize: 10 }}>…</span>
                          ) : null}
                        </td>
                        <td style={{ padding: '9px 10px', fontWeight: 700, color: probColor(p.probability) }}>
                          {fmtPct(p.probability)}
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
    </div>
  )
}
