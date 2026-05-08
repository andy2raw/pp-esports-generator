import { fmtPct, probColor } from '../utils/ev.js'

const RESULTS = ['Win', 'Loss', 'Pending']

const RESULT_STYLE = {
  Win:     { active: { bg: '#22c55e', color: '#000' }, idle: { bg: '#1a2a1a', color: '#22c55e', border: '#22c55e55' } },
  Loss:    { active: { bg: '#ef4444', color: '#fff' }, idle: { bg: '#2a1a1a', color: '#ef4444', border: '#ef444455' } },
  Pending: { active: { bg: '#333',    color: '#aaa' }, idle: { bg: '#1a1a1a', color: '#555',    border: '#333'      } },
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtPnl(pnl) {
  return pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`
}

function borderColor(result) {
  if (result === 'Win')  return '#22c55e44'
  if (result === 'Loss') return '#ef444444'
  return '#2a2a2a'
}

export default function SlipTracker({
  trackedSlips, setResult, removeSlip,
  playerHistory, wins, losses, pnl, winRate, settled, pending,
  supabaseLoading,
}) {
  const reliablePlayers = Object.values(playerHistory)
    .filter(p => p.hits + p.misses >= 2)
    .map(p => ({ ...p, rate: p.hits / (p.hits + p.misses) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)

  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #242424' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 16 }}>
        SLIP TRACKER
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Record',   value: `${wins}W — ${losses}L` },
          { label: 'Win Rate', value: winRate ? `${winRate}%` : '—' },
          { label: 'P&L',      value: fmtPnl(pnl), color: pnl > 0 ? 'var(--green)' : pnl < 0 ? 'var(--red)' : 'var(--cream)' },
          { label: 'Pending',  value: String(pending) },
        ].map(stat => (
          <div key={stat.label} style={{
            background: '#212121', border: '1px solid #2a2a2a', borderRadius: 8,
            padding: '10px 16px', minWidth: 80,
          }}>
            <div style={{ fontSize: 9, color: '#555', letterSpacing: 0.5, marginBottom: 5 }}>{stat.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stat.color || 'var(--cream)' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Most Reliable Players */}
      {reliablePlayers.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: 0.5, marginBottom: 8 }}>
            MOST RELIABLE PLAYERS
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {reliablePlayers.map(p => (
              <div key={p.name} style={{
                background: '#1a2a1a', border: '1px solid #22c55e33',
                borderRadius: 6, padding: '5px 10px', fontSize: 11,
              }}>
                <span style={{ color: 'var(--cream)', fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: 'var(--green)', marginLeft: 6 }}>{(p.rate * 100).toFixed(0)}%</span>
                <span style={{ color: '#555', marginLeft: 4, fontSize: 10 }}>{p.hits}W {p.misses}L</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slip history */}
      {supabaseLoading ? (
        <div style={{ color: '#3a3a3a', fontSize: 12, padding: '28px 0', textAlign: 'center' }}>
          Loading tracked slips…
        </div>
      ) : trackedSlips.length === 0 ? (
        <div style={{ color: '#3a3a3a', fontSize: 12, padding: '28px 0', textAlign: 'center' }}>
          No tracked slips yet — click Track on any slip card.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {trackedSlips.map(slip => (
            <div key={slip.id} style={{
              background: '#202020',
              border: `1px solid ${borderColor(slip.result)}`,
              borderRadius: 8, padding: '11px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 10, color: '#555' }}>
                  {fmtDate(slip.timestamp)} · {slip.slipType || `${slip.legCount}-leg`}
                  {slip.goblinCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 5 }}>{slip.goblinCount} gob</span>}
                </span>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {RESULTS.map(r => {
                    const isActive = slip.result === r
                    const s = RESULT_STYLE[r]
                    return (
                      <button key={r} onClick={() => setResult(slip.id, r)} style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                        background: isActive ? s.active.bg : s.idle.bg,
                        border:     `1px solid ${isActive ? s.active.bg : s.idle.border}`,
                        color:      isActive ? s.active.color : s.idle.color,
                      }}>
                        {r}
                      </button>
                    )
                  })}
                  <button onClick={() => removeSlip(slip.id)} style={{
                    fontSize: 12, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'none', border: 'none', color: '#3a3a3a',
                  }}>✕</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {slip.picks.map((p, i) => (
                  <div key={i} style={{ fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: 'var(--cream)', fontWeight: 600 }}>{p.playerName}</span>
                    <span style={{ color: '#666' }}>{p.statType} O{p.line}</span>
                    <span style={{ color: probColor(p.probability) }}>{fmtPct(p.probability)}</span>
                    {p.oddsType === 'goblin' && (
                      <span style={{ fontSize: 9, color: '#f59e0b' }}>GOBLIN</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
