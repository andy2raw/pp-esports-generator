import { fmtPct, fmtEV, probColor, isLineGoblin, isLock } from '../utils/ev.js'

export default function SlipCard({ combo, rank, variant, confidence, onTrack }) {
  const { picks, ev, jointProb, goblinCount } = combo
  const legCount = picks.length
  const isLottery = variant === 'lottery'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {confidence != null && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: confidence >= 7 ? '#22c55e22' : confidence >= 5 ? '#eab30822' : '#ef444422',
              border: `1px solid ${confidence >= 7 ? '#22c55e55' : confidence >= 5 ? '#eab30855' : '#ef444455'}`,
              borderRadius: 6, padding: '3px 8px', minWidth: 36,
            }}>
              <span style={{
                fontSize: 18, fontWeight: 800, lineHeight: 1,
                color: confidence >= 7 ? 'var(--green)' : confidence >= 5 ? 'var(--yellow)' : 'var(--red)',
              }}>{confidence}</span>
              <span style={{ fontSize: 7, color: '#555', letterSpacing: 0.3 }}>CONF</span>
            </div>
          )}
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: ev >= 0 ? 'var(--green)' : isLottery ? '#c9a84c' : 'var(--red)',
          }}>
            EV {fmtEV(ev)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#777', marginBottom: 8 }}>
        Joint prob: {fmtPct(jointProb)}
        {goblinCount > 0 && (
          <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>
            {goblinCount} goblin{goblinCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {onTrack && (
        <button
          onClick={onTrack}
          style={{
            width: '100%', marginBottom: 10, padding: '7px 0',
            background: '#1a2a1a', border: '1px solid #22c55e55',
            color: 'var(--green)', borderRadius: 6,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            cursor: 'pointer',
          }}
        >
          + Track This Slip
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {picks.map(p => (
          <div key={p.id} className="slip-card-pick" style={{
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
              {isLock(p.line, p.statType) ? (
                <span style={{
                  marginLeft: 5, fontSize: 9, background: '#1d4ed822', color: '#60a5fa',
                  border: '1px solid #1d4ed855', borderRadius: 3, padding: '1px 4px',
                  fontWeight: 700,
                }}>LOCK</span>
              ) : isLineGoblin(p.line, p.league, p.statType) ? (
                <span style={{
                  marginLeft: 5, fontSize: 9, background: '#16a34a22', color: '#16a34a',
                  border: '1px solid #16a34a55', borderRadius: 3, padding: '1px 4px',
                  fontWeight: 700,
                }}>GOBLIN</span>
              ) : null}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: probColor(p.probability) }}>
              {fmtPct(p.probability)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
