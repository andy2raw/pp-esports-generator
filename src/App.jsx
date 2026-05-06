import { useState, useMemo } from 'react'
import { usePrizePicks } from './hooks/usePrizePicks.js'
import { usePandaScore } from './hooks/usePandaScore.js'
import { bestCombos, groupByMatch } from './utils/combos.js'
import { fmtPct, fmtEV, probColor, calcEV } from './utils/ev.js'
import SlipCard from './components/SlipCard.jsx'
import StatsBadge from './components/StatsBadge.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const LEAGUES = ['ALL', 'LOL', 'CSGO', 'VAL', 'DOTA2']

export default function App() {
  const [league, setLeague] = useState('ALL')
  const { projections, loading, error, lastRefresh, countdown, refresh } = usePrizePicks()
  const { getStatLine, psLoading } = usePandaScore(projections)

  const filtered = useMemo(
    () => league === 'ALL' ? projections : projections.filter(p => p.league === league),
    [projections, league],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => {
      if (a.oddsType === 'goblin' && b.oddsType !== 'goblin') return 1
      if (b.oddsType === 'goblin' && a.oddsType !== 'goblin') return -1
      return b.probability - a.probability
    }),
    [filtered],
  )

  const slipPool = useMemo(() => filtered.filter(p => p.oddsType !== 'goblin'), [filtered])
  const combos2 = useMemo(() => bestCombos(slipPool, 2, 3), [slipPool])
  const combos4 = useMemo(() => bestCombos(slipPool, 4, 3), [slipPool])
  const combos6 = useMemo(() => bestCombos(slipPool, 6, 3), [slipPool])
  const matchGroups = useMemo(() => groupByMatch(sorted), [sorted])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--cream)', fontFamily: 'system-ui, sans-serif' }}>
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
        {(combos2.length > 0 || combos4.length > 0 || combos6.length > 0) && (
          <ErrorBoundary label="Slip cards error">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
              {combos2.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>2-LEG SLIPS</div>
                  {combos2.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} />)}
                </div>
              )}
              {combos4.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>4-LEG SLIPS</div>
                  {combos4.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} />)}
                </div>
              )}
              {combos6.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>6-LEG SLIPS</div>
                  {combos6.map((c, i) => <SlipCard key={i} combo={c} rank={i + 1} />)}
                </div>
              )}
            </div>
          </ErrorBoundary>
        )}

        {matchGroups.length > 0 && (
          <ErrorBoundary label="Match picks error">
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 10 }}>
                BEST SINGLE MATCH PICKS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {matchGroups.map(group => {
                  const time = group.startTime
                    ? new Date(group.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''
                  return (
                    <div key={group.key} style={{ background: '#242424', border: '1px solid #2e2e2e', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: 0.5 }}>{group.league}</span>
                        {time && <span style={{ fontSize: 10, color: '#444' }}>{time}</span>}
                      </div>
                      {group.picks.map((p, i) => (
                        <div key={p.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '5px 8px', borderRadius: 5, marginBottom: 4,
                          background: i === 0 ? '#1a2e1a' : '#1c1c1c',
                          border: i === 0 ? '1px solid #22c55e33' : '1px solid transparent',
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: i === 0 ? 'var(--cream)' : '#aaa', marginRight: 5 }}>
                              {p.playerName}
                            </span>
                            <span style={{ fontSize: 10, color: '#555' }}>{p.statType} O{p.line}</span>
                            {p.team && (
                              <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>{p.team}</div>
                            )}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: probColor(p.probability), whiteSpace: 'nowrap', marginLeft: 8 }}>
                            {fmtPct(p.probability)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
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
      </div>
    </div>
  )
}
