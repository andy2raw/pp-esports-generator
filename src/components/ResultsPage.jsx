// NOTE: This page uses setResult(id, 'Win' | 'Loss' | 'Push').
// The slips table result column must accept 'Push' as a value.
// If you have a check constraint, add 'Push' to it in the Supabase dashboard.

import { fmtPct, fmtEV, getEffectiveMult } from '../utils/ev.js'

const STAKE = 10

function ResultBadge({ result }) {
  const map = {
    Win:  { color: '#22c55e', bg: '#22c55e14', border: '#22c55e40', label: 'WIN' },
    Loss: { color: '#ef4444', bg: '#ef444414', border: '#ef444440', label: 'LOSS' },
    Push: { color: '#eab308', bg: '#eab30814', border: '#eab30840', label: 'PUSH' },
  }
  const s = map[result]
  if (!s) return null
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 4, padding: '2px 7px',
    }}>{s.label}</span>
  )
}

function SlipRow({ slip, setResult }) {
  const ts = slip.timestamp ? new Date(slip.timestamp).toLocaleDateString() : '—'
  const isPending = slip.result === 'Pending' || !slip.result

  return (
    <div style={{
      background: '#1a1a1a', border: `1px solid ${isPending ? '#2a2a2a' : '#333'}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cream)' }}>{slip.slipType}</span>
          <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>
            {slip.league} · {slip.legCount}-leg · {ts}
          </span>
        </div>
        {isPending
          ? <span style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: 0.5 }}>PENDING</span>
          : <ResultBadge result={slip.result} />
        }
      </div>

      <div style={{ fontSize: 10, color: '#666', marginBottom: 10, lineHeight: 1.5 }}>
        {(slip.picks || []).map(p => p.playerName).join(' · ')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {[
          { label: 'WIN',  value: 'Win',  color: '#22c55e', activeBg: '#22c55e33', inactiveBg: '#22c55e11', border: '#22c55e55' },
          { label: 'LOSS', value: 'Loss', color: '#ef4444', activeBg: '#ef444433', inactiveBg: '#ef444411', border: '#ef444455' },
          { label: 'PUSH', value: 'Push', color: '#eab308', activeBg: '#eab30833', inactiveBg: '#eab30811', border: '#eab30855' },
        ].map(btn => (
          <button
            key={btn.value}
            onClick={() => setResult(slip.id, btn.value)}
            style={{
              padding: '7px 0',
              background: slip.result === btn.value ? btn.activeBg : btn.inactiveBg,
              border: `1px solid ${btn.border}`,
              color: btn.color, borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', letterSpacing: 0.4,
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ResultsPage({ trackedSlips, setResult }) {
  const pending  = trackedSlips.filter(s => !s.result || s.result === 'Pending')
  const settled  = trackedSlips.filter(s => s.result && s.result !== 'Pending')
  const wins     = trackedSlips.filter(s => s.result === 'Win').length
  const losses   = trackedSlips.filter(s => s.result === 'Loss').length
  const pushes   = trackedSlips.filter(s => s.result === 'Push').length
  const hitDenom = wins + losses
  const hitRate  = hitDenom > 0 ? (wins / hitDenom * 100).toFixed(1) : null

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--cream)', marginBottom: 14 }}>
        Results
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'WINS',    value: wins,                          color: '#22c55e' },
          { label: 'LOSSES',  value: losses,                        color: '#ef4444' },
          { label: 'PUSHES',  value: pushes,                        color: '#eab308' },
          { label: 'PENDING', value: pending.length,                color: '#555'    },
          { label: 'HIT %',   value: hitRate ? `${hitRate}%` : '—', color: hitRate >= 60 ? '#22c55e' : '#aaa' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8,
            padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 8, color: '#555', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Pending slips */}
      {pending.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: 1, marginBottom: 8 }}>
            PENDING ({pending.length})
          </div>
          {pending.map(slip => (
            <SlipRow key={slip.id} slip={slip} setResult={setResult} />
          ))}
        </>
      )}

      {/* Settled slips */}
      {settled.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: 1,
            marginBottom: 8, marginTop: pending.length > 0 ? 20 : 0,
          }}>
            SETTLED ({settled.length})
          </div>
          {[...settled].reverse().map(slip => (
            <SlipRow key={slip.id} slip={slip} setResult={setResult} />
          ))}
        </>
      )}

      {trackedSlips.length === 0 && (
        <div style={{ color: '#444', fontSize: 12, textAlign: 'center', padding: '40px 0' }}>
          No tracked slips yet. Click "+ Track This Slip" on any slip card.
        </div>
      )}
    </div>
  )
}
