import { useState } from 'react'
import { fmtPct, fmtEV, probColor } from '../utils/ev.js'

export default function SlipCard({ combo, rank, onTrack, variant }) {
  const { picks, ev, jointProb, goblinCount } = combo
  const legCount = picks.length
  const isLottery = variant === 'lottery'
  const [tracked, setTracked] = useState(false)

  function handleTrack() {
    if (onTrack && !tracked) {
      onTrack(combo)
      setTracked(true)
      setTimeout(() => setTracked(false), 2000)
    }
  }

  return (
    <div style={{
      background: isLottery ? '#1f1c14' : '#242424',
      border: `1px solid ${isLottery ? '#c9a84c' : '#333'}`,
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 12,
      boxShadow: isLottery ? '0 0 12px #c9a84c22' : 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: isLottery ? '#c9a84c' : '#888' }}>
          {isLottery ? 'LOTTERY TICKET' : `#${rank} — ${legCount}-LEG SLIP`}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: ev >= 0 ? 'var(--green)' : isLottery ? '#c9a84c' : 'var(--red)',
        }}>
          EV {fmtEV(ev)}
        </span>
      </div>

      <div style={{ fontSize: 11, color: '#777', marginBottom: 8 }}>
        Joint prob: {fmtPct(jointProb)}
        {goblinCount > 0 && (
          <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>
            {goblinCount} goblin{goblinCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: onTrack ? 10 : 0 }}>
        {picks.map(p => (
          <div key={p.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 10px', background: isLottery ? '#17140a' : '#1c1c1c', borderRadius: 6,
          }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cream)' }}>
                {p.playerName}
              </span>
              {p.oddsType === 'goblin' && (
                <span style={{
                  marginLeft: 5, fontSize: 9, background: '#f59e0b22', color: '#f59e0b',
                  border: '1px solid #f59e0b55', borderRadius: 3, padding: '1px 4px',
                }}>GOBLIN</span>
              )}
              <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>
                {p.statType} O{p.line}
              </span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: probColor(p.probability) }}>
              {fmtPct(p.probability)}
            </span>
          </div>
        ))}
      </div>

      {onTrack && (
        <button
          onClick={handleTrack}
          style={{
            width: '100%', padding: '6px 0', borderRadius: 5, fontSize: 11, fontWeight: 600,
            cursor: tracked ? 'default' : 'pointer',
            background: tracked ? '#1a2e1a' : 'transparent',
            border: `1px solid ${tracked ? '#22c55e55' : '#333'}`,
            color: tracked ? 'var(--green)' : '#555',
            transition: 'all 0.2s',
          }}
        >
          {tracked ? '✓ Tracked' : 'Track this slip'}
        </button>
      )}
    </div>
  )
}
