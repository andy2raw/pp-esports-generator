import { useLadder, STARTING_BANKROLL, MULTIPLIER } from '../hooks/useLadder.js'
import { fmtPct, fmtEV } from '../utils/ev.js'

function BankrollChart({ data }) {
  if (data.length < 2) return (
    <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 11 }}>
      Win a slip to start the chart
    </div>
  )
  const W = 100, H = 70, PAD = 8
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - 2 * PAD)
    const y = PAD + (1 - (v - min) / range) * (H - 2 * PAD)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80, display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth={1.5} strokeLinejoin="round" />
      {data.map((v, i) => {
        const x = PAD + (i / (data.length - 1)) * (W - 2 * PAD)
        const y = PAD + (1 - (v - min) / range) * (H - 2 * PAD)
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={2} fill="#22c55e" />
      })}
    </svg>
  )
}

function SlipPreview({ slip }) {
  if (!slip) return (
    <div style={{ color: '#555', fontSize: 12, padding: '12px 0' }}>
      No Precision 2-Leg slip available today.
    </div>
  )
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
        Joint prob: {fmtPct(slip.jointProb)} · EV {fmtEV(slip.ev)}
      </div>
      {slip.picks.map((p, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '6px 10px', background: '#1c1c1c', borderRadius: 6, marginBottom: 4,
        }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cream)' }}>{p.playerName}</span>
            <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>{p.statType} O{p.line}</span>
            {p.overUnder && (
              <span style={{
                marginLeft: 5, fontSize: 9, fontWeight: 700,
                background: p.overUnder === 'OVER' ? '#22c55e14' : '#ef444414',
                color: p.overUnder === 'OVER' ? '#22c55e' : '#ef4444',
                border: `1px solid ${p.overUnder === 'OVER' ? '#22c55e40' : '#ef444440'}`,
                borderRadius: 3, padding: '1px 4px',
              }}>{p.overUnder}</span>
            )}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>
            {fmtPct(p.probability)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function LadderChallenge({ todaySlip }) {
  const {
    loading, currentBankroll, currentStreak, bestStreak,
    pendingEntry, chartData, entries,
    addEntry, recordResult, restart,
  } = useLadder()

  const settled = entries.filter(e => e.result !== 'Pending')
  const level = currentStreak
  const totalPlays = settled.length

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 13 }}>
        Loading ladder...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#c9a84c', letterSpacing: -0.5, marginBottom: 4 }}>
          ★ Ladder Challenge
        </div>
        <div style={{ fontSize: 11, color: '#555' }}>
          Win a Precision 2-Leg slip → bankroll ×{MULTIPLIER}. Lose → reset to ${STARTING_BANKROLL}.
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'BANKROLL',    value: `$${currentBankroll.toFixed(2)}`, color: '#22c55e' },
          { label: 'STREAK',      value: `${currentStreak}W`,              color: currentStreak > 0 ? '#c9a84c' : '#888' },
          { label: 'BEST STREAK', value: `${bestStreak}W`,                 color: '#888' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
            padding: '10px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#555', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Level bar */}
      {level > 0 && (
        <div style={{
          background: '#1a1800', border: '1px solid #c9a84c44', borderRadius: 8,
          padding: '8px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>{'🔥'.repeat(Math.min(level, 5))}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c9a84c' }}>Level {level}</div>
            <div style={{ fontSize: 10, color: '#888' }}>
              Next win: ${(currentBankroll * MULTIPLIER).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Bankroll chart */}
      <div style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8,
        padding: '10px 14px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: 0.5, marginBottom: 6 }}>BANKROLL GROWTH</div>
        <BankrollChart data={chartData} />
        {totalPlays > 0 && (
          <div style={{ fontSize: 10, color: '#555', marginTop: 4, textAlign: 'right' }}>
            {totalPlays} play{totalPlays !== 1 ? 's' : ''} · Starting ${STARTING_BANKROLL}
          </div>
        )}
      </div>

      {/* Today's slip + action */}
      <div style={{
        background: '#181818', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px',
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: 1, marginBottom: 8 }}>
          TODAY'S SLIP
        </div>

        {pendingEntry ? (
          <>
            <div style={{
              fontSize: 11, color: '#c9a84c', marginBottom: 12,
              padding: '6px 10px', background: '#1a1800', borderRadius: 6,
            }}>
              Slip in play — enter your result below.
            </div>
            {/* Pending slip picks */}
            {Array.isArray(pendingEntry.slip_picks) && pendingEntry.slip_picks.map((p, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '6px 10px', background: '#1c1c1c', borderRadius: 6, marginBottom: 4,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cream)' }}>{p.playerName}</span>
                <span style={{ fontSize: 10, color: '#888' }}>{p.statType} O{p.line}</span>
              </div>
            ))}
            {/* Win / Loss buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => recordResult(pendingEntry.id, 'Win')}
                style={{
                  padding: '12px 0', background: '#16a34a22', border: '1px solid #16a34a55',
                  color: '#22c55e', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >
                ✓ WIN
              </button>
              <button
                onClick={() => recordResult(pendingEntry.id, 'Loss')}
                style={{
                  padding: '12px 0', background: '#ef444414', border: '1px solid #ef444440',
                  color: '#ef4444', borderRadius: 8, fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}
              >
                ✗ LOSS
              </button>
            </div>
          </>
        ) : (
          <>
            <SlipPreview slip={todaySlip} />
            {todaySlip && (
              <button
                onClick={() => addEntry(todaySlip)}
                style={{
                  width: '100%', marginTop: 12, padding: '12px 0',
                  background: '#22c55e22', border: '1px solid #22c55e55',
                  color: 'var(--green)', borderRadius: 8,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Play Today · ${currentBankroll.toFixed(2)}
              </button>
            )}
          </>
        )}
      </div>

      {/* History */}
      {settled.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: 0.5, marginBottom: 8 }}>HISTORY</div>
          {[...settled].reverse().slice(0, 10).map(e => (
            <div key={e.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 10px', background: '#181818', borderRadius: 6, marginBottom: 4,
            }}>
              <span style={{ fontSize: 10, color: '#555' }}>
                {new Date(e.created_at).toLocaleDateString()}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: e.result === 'Win' ? '#22c55e' : '#ef4444',
              }}>{e.result}</span>
              <span style={{ fontSize: 11, color: '#888' }}>${e.bankroll.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Restart */}
      <button
        onClick={restart}
        style={{
          width: '100%', padding: '10px 0', background: 'transparent',
          border: '1px solid #333', color: '#555', borderRadius: 8,
          fontSize: 12, cursor: 'pointer',
        }}
      >
        ↺ Restart Ladder
      </button>
    </div>
  )
}
