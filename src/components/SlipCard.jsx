import { fmtPct, fmtEV, probColor, isLock, isGoblin } from '../utils/ev.js'

const SLIP_LABELS = { 2: 'PRECISION 2-LEG', 3: 'EDGE 3-LEG', 4: 'CORE 4-LEG', 6: 'LOTTERY 6-LEG' }

function riskTier(jointProb) {
  if (jointProb > 0.50) return { label: 'LOW',     color: '#22c55e', bg: '#22c55e14', border: '#22c55e40' }
  if (jointProb > 0.25) return { label: 'MEDIUM',  color: '#eab308', bg: '#eab30814', border: '#eab30840' }
  if (jointProb > 0.10) return { label: 'HIGH',    color: '#f97316', bg: '#f9731614', border: '#f9731640' }
  return                       { label: 'LOTTERY', color: '#ef4444', bg: '#ef444414', border: '#ef444440' }
}

function correlationRating(picks) {
  const teamCounts = {}
  for (const p of picks) {
    if (p.team) teamCounts[p.team] = (teamCounts[p.team] ?? 0) + 1
  }
  if (Object.values(teamCounts).some(c => c > 1)) {
    return { label: 'CORRELATED',  color: '#ef4444', bg: '#ef444414', border: '#ef444440' }
  }
  const uniqueLeagues = new Set(picks.map(p => p.league || ''))
  if (uniqueLeagues.size === picks.length) {
    return { label: 'INDEPENDENT', color: '#22c55e', bg: '#22c55e14', border: '#22c55e40' }
  }
  return   { label: 'NEUTRAL',    color: '#eab308', bg: '#eab30814', border: '#eab30840' }
}

function whySelected({ picks, goblinCount }) {
  const games = new Set(picks.map(p => p.league || '')).size
  const crossGame = games >= 2
  if (goblinCount === 0 && crossGame) return 'Highest-probability standard props with cross-game diversification.'
  if (goblinCount === 0)              return 'Pure standard props — clean edge, no goblin dependency.'
  if (goblinCount >= 2 && crossGame)  return 'Goblin boost with cross-game spread minimizes joint correlation risk.'
  if (goblinCount >= 1 && crossGame)  return 'Standard foundation with goblin tail bonus across multiple games.'
  if (goblinCount >= 1)               return 'Goblin tail pick boosts joint probability on a standard foundation.'
  return 'Selected for highest joint probability available today.'
}

export default function SlipCard({ combo, rank, variant, confidence, onTrack }) {
  const { picks, ev, jointProb, goblinCount } = combo
  const legCount  = picks.length
  const isLottery = variant === 'lottery'
  const isCore4   = variant === 'core4'

  const risk      = riskTier(jointProb)
  const corr      = correlationRating(picks)
  const whyLine   = whySelected(combo)
  const slipLabel = SLIP_LABELS[legCount] || `${legCount}-LEG`

  const probs        = picks.map(p => p.probability)
  const maxProb      = Math.max(...probs)
  const minProb      = Math.min(...probs)
  const hasDiversity = maxProb > minProb + 0.001

  const borderColor = isLottery ? '#c9a84c' : isCore4 ? '#b8860b' : '#333'
  const bgColor     = isLottery ? '#1f1c14' : isCore4 ? '#191506' : '#242424'
  const accentColor = isLottery || isCore4 ? '#c9a84c' : '#888'

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      padding: isCore4 ? '18px 20px' : '14px 16px',
      marginBottom: 12,
      boxShadow: isLottery ? '0 0 12px #c9a84c22' : isCore4 ? '0 0 20px #b8860b33' : 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: isCore4 ? 13 : 11, fontWeight: 700, letterSpacing: 1, color: accentColor }}>
          {isCore4 ? `★ ${slipLabel}  #${rank}` : isLottery ? slipLabel : `#${rank} — ${slipLabel}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* Correlation */}
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
            background: corr.bg, color: corr.color, border: `1px solid ${corr.border}`,
            borderRadius: 4, padding: '2px 5px',
          }}>{corr.label}</span>

          {/* Risk tier */}
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            background: risk.bg, color: risk.color, border: `1px solid ${risk.border}`,
            borderRadius: 4, padding: '2px 6px',
          }}>{risk.label}</span>

          {/* Confidence */}
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

          {/* EV */}
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: ev >= 0 ? 'var(--green)' : isLottery ? '#c9a84c' : 'var(--red)',
          }}>
            EV {fmtEV(ev)}
          </span>
        </div>
      </div>

      {/* Why selected */}
      <p style={{ margin: '0 0 8px', fontSize: 10, color: '#666', lineHeight: 1.4, fontStyle: 'italic' }}>
        {whyLine}
      </p>

      {/* Joint prob + goblin count */}
      <div style={{ fontSize: 11, color: '#777', marginBottom: 8 }}>
        Joint prob: {fmtPct(jointProb)}
        {goblinCount > 0 && (
          <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>
            {goblinCount} goblin{goblinCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Track button */}
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

      {/* Picks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {picks.map(p => {
          const strongest = hasDiversity && p.probability === maxProb
          const weakest   = hasDiversity && p.probability === minProb
          const goblin    = !isLock(p.line, p.statType) && isGoblin(p)
          return (
            <div key={p.id ?? `${p.playerName}-${p.statType}`} className="slip-card-pick" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 10px',
              background: strongest ? '#0d1f0d' : weakest ? '#1f0d0d' : (isLottery ? '#17140a' : '#1c1c1c'),
              borderRadius: 6,
              border: strongest ? '1px solid #22c55e22' : weakest ? '1px solid #ef444422' : 'none',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cream)' }}>
                  {p.playerName}
                </span>
                {strongest && <span style={{ fontSize: 11 }} title="Strongest leg">⚡</span>}
                {weakest   && <span style={{ fontSize: 11 }} title="Weakest leg">⚠️</span>}
                {goblin && (
                  <span style={{
                    fontSize: 9, background: '#16a34a22', color: '#16a34a',
                    border: '1px solid #16a34a55', borderRadius: 3, padding: '1px 4px', fontWeight: 700,
                  }}>GOBLIN</span>
                )}
                {isLock(p.line, p.statType) && (
                  <span style={{
                    fontSize: 9, background: '#1d4ed822', color: '#60a5fa',
                    border: '1px solid #1d4ed855', borderRadius: 3, padding: '1px 4px', fontWeight: 700,
                  }}>LOCK</span>
                )}
                {p.sharp && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    background: '#eab30814', color: '#eab308',
                    border: '1px solid #eab30840', borderRadius: 3, padding: '1px 4px',
                  }}>SHARP</span>
                )}
                {p.oddsType === 'demon' && (
                  <span style={{
                    fontSize: 9, background: '#6b21a822', color: '#a78bfa',
                    border: '1px solid #6b21a855', borderRadius: 3, padding: '1px 4px', fontWeight: 700,
                  }}>DEMON</span>
                )}
                <span style={{ fontSize: 10, color: '#888' }}>
                  {p.statType} O{p.line}
                </span>
                {/* OVER/UNDER recommendation */}
                {p.overUnder && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    background: p.overUnder === 'OVER' ? '#22c55e14' : '#ef444414',
                    color: p.overUnder === 'OVER' ? '#22c55e' : '#ef4444',
                    border: `1px solid ${p.overUnder === 'OVER' ? '#22c55e40' : '#ef444440'}`,
                    borderRadius: 3, padding: '1px 4px',
                  }}>{p.overUnder}</span>
                )}
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, flexShrink: 0, marginLeft: 8,
                color: strongest ? 'var(--green)' : weakest ? 'var(--red)' : probColor(p.probability),
              }}>
                {fmtPct(p.probability)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
