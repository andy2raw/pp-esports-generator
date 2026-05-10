import { useState, useMemo, useEffect, useRef } from 'react'
import { usePrizePicks } from './hooks/usePrizePicks.js'
import { usePandaScore } from './hooks/usePandaScore.js'
import { useSlipTracker } from './hooks/useSlipTracker.js'
import { bestCombos } from './utils/combos.js'
import { fmtPct, fmtEV, probColor, calcEV, calcConfidence, lineBasedProb } from './utils/ev.js'
import SlipCard from './components/SlipCard.jsx'
import StatsBadge from './components/StatsBadge.jsx'
import SlipTracker from './components/SlipTracker.jsx'
import DailyQuote from './components/DailyQuote.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const LEAGUES = ['ALL', 'LOL', 'CSGO', 'VAL', 'DOTA2']

// Sort projections by probability adjusted for player track record.
// playerScores[name] is a 0-1 hit rate; defaults to 1 (no penalty) if unknown.
function scoredSort(arr, playerScores) {
  return [...arr].sort((a, b) => {
    const sa = a.probability * (playerScores[a.playerName] ?? 1)
    const sb = b.probability * (playerScores[b.playerName] ?? 1)
    return sb - sa
  })
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

  // Use server-computed probability when available (based on real L5/season vs line).
  // Falls back to lineBasedProb heuristic while the stats API is still loading.
  const adjustedProjections = useMemo(
    () => projections.map(p => {
      const prob = getCalcProb(p.playerName, p.league, p.statType)
                ?? lineBasedProb(p.line, p.league, p.statType)
      return { ...p, probability: prob }
    }),
    [projections, getCalcProb],
  )

  // Table view respects the active league filter
  const filtered = useMemo(
    () => league === 'ALL' ? adjustedProjections : adjustedProjections.filter(p => p.league === league),
    [adjustedProjections, league],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      if (a.oddsType === 'goblin' && b.oddsType !== 'goblin') return 1
      if (b.oddsType === 'goblin' && a.oddsType !== 'goblin') return -1
      return b.probability - a.probability
    }),
    [filtered],
  )

  // Slip pool uses adjusted probabilities + tracker history scores so both
  // PandaScore L5 data and personal W/L record influence pick ranking.
  const slipPool = useMemo(() => {
    if (league === 'ALL') {
      return scoredSort(adjustedProjections, playerScores)
    }
    const primary = scoredSort(adjustedProjections.filter(p => p.league === league), playerScores)
    const secondary = scoredSort(adjustedProjections.filter(p => p.league !== league), playerScores)
    return [...primary, ...secondary]
  }, [adjustedProjections, league, playerScores])

  // Lottery pool: always all leagues, adjusted probabilities
  const lotteryPool = useMemo(
    () => scoredSort(adjustedProjections, playerScores),
    [adjustedProjections, playerScores],
  )

  const combos2Raw     = useMemo(() => bestCombos(slipPool, 2, 3),       [slipPool])
  const combos3Raw     = useMemo(() => bestCombos(slipPool, 3, 3),       [slipPool])
  const combos4Raw     = useMemo(() => bestCombos(slipPool, 4, 3),       [slipPool])
  const lotterySlipRaw = useMemo(() => bestCombos(lotteryPool, 6, 1)[0] ?? null, [lotteryPool])

  // Attach a 1-10 confidence score to each combo.
  // Recomputed whenever stats or player history update.
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

  // ── Auto-save all generated slips on first successful load ─────────────────
  // Fires once per session after both Supabase and PrizePicks data are ready.
  // Skips any slip already saved (matched by the stable composite key).
  const autoSavedRef = useRef(false)
  useEffect(() => {
    if (autoSavedRef.current) return
    if (supabaseLoading) return
    if (!combos2.length && !combos3.length && !combos4.length && !lotterySlip) return

    autoSavedRef.current = true

    const existingIds = new Set(trackedSlips.map(s => s.id))

    function maybeAdd(combo, slipType, leagueArg) {
      // Must match rowKey() format in useSlipTracker.js
      const key = `${slipType}|${combo.picks.length}|${Number(combo.ev).toFixed(8)}|${Number(combo.jointProb).toFixed(8)}`
      if (!existingIds.has(key)) addSlip(combo, slipType, leagueArg)
    }

    combos2.forEach(c => maybeAdd(c, '2-leg', league))
    combos3.forEach(c => maybeAdd(c, '3-leg', league))
    combos4.forEach(c => maybeAdd(c, '4-leg', league))
    if (lotterySlip) maybeAdd(lotterySlip, 'lottery-6', 'ALL')
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
          Esports lines are mostly Goblin picks — negative EV is expected. Focus on highest probability picks.
        </p>

        {hasSlips && (
          <ErrorBoundary label="Slip cards error">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
              {combos2.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>2-LEG SLIPS</div>
                  {combos2.map((c, i) => (
                    <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                      onTrack={() => addSlip(c, '2-leg', league)} />
                  ))}
                </div>
              )}
              {combos3.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>3-LEG SLIPS</div>
                  {combos3.map((c, i) => (
                    <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                      onTrack={() => addSlip(c, '3-leg', league)} />
                  ))}
                </div>
              )}
              {combos4.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>4-LEG SLIPS</div>
                  {combos4.map((c, i) => (
                    <SlipCard key={i} combo={c} rank={i + 1} confidence={c.confidence}
                      onTrack={() => addSlip(c, '4-leg', league)} />
                  ))}
                </div>
              )}
              {lotterySlip && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#c9a84c', letterSpacing: 1, marginBottom: 8 }}>6-LEG LOTTERY</div>
                  <SlipCard combo={lotterySlip} rank={1} variant="lottery" confidence={lotterySlip.confidence}
                    onTrack={() => addSlip(lotterySlip, 'lottery-6', 'ALL')} />
                </div>
              )}
            </div>
          </ErrorBoundary>
        )}

        <ErrorBoundary label="Projections table error">
          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 10 }}>
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
                    const goblin = p.oddsType === 'goblin'
                    const ev2 = calcEV(p.probability, 2, goblin ? 1 : 0)
                    const ev4 = calcEV(p.probability, 4, goblin ? 1 : 0)
                    const sl = getStatLine(p.playerName, p.league, p.statType)
                    const hasHistory = playerHistory[p.playerName]
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #1f1f1f' }}>
                        <td style={{ padding: '9px 10px', color: 'var(--cream)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {p.playerName}
                          {goblin && (
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
                        <td style={{ padding: '9px 10px', fontVariantNumeric: 'tabular-nums' }}>{p.line}</td>
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
