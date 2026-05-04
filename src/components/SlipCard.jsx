import { fmtPct, fmtEV, probColor, getEffectiveMult } from '../utils/ev.js'

export default function SlipCard({ combo, rank }) {
  const { picks, ev, jointProb, goblinCount } = combo
  const legCount = picks.length

  return (
    <div style={{
      background: '#242424', border: '1px solid #333', borderRadius: 10,
      padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: 1 }}>
          #{rank} — {legCount}-LEG SLIP
        </span>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: ev >= 0 ? 'var(--green)' : 'var(--red)',
        }}>
          EV {fmtEV(ev)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        Joint prob: {fmtPct(jointProb)}
        {goblinCount > 0 && (
          <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>
            {goblinCount} goblin{goblinCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {picks.map(p => (
          <div key={p.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 10px', background: '#1c1c1c', borderRadius: 6,
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
    </div>
  )
}
