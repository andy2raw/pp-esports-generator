// Green  — L5 avg beats the line
// Yellow — L5 avg trails by ≤ 3  (close, worth monitoring)
// Red    — L5 avg trails by > 3  (consistently short)
function dotColor(avg, line) {
  if (avg >= line) return 'var(--green)'
  if (avg >= line - 3) return 'var(--yellow)'
  return 'var(--red)'
}

export default function StatsBadge({ seasonAvg, last5Avg, line }) {
  // Prefer L5; fall back to season avg
  const primary = last5Avg ?? seasonAvg
  if (primary == null) return null

  const color = dotColor(primary, line)
  const label = last5Avg != null ? 'L5' : 'Szn'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
      {/* Colored indicator dot */}
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: color, display: 'inline-block', flexShrink: 0,
        boxShadow: `0 0 4px ${color}`,
      }} />
      <span style={{ color: '#aaa', fontVariantNumeric: 'tabular-nums' }}>
        {label} {primary.toFixed(1)}
      </span>
      {/* Show season avg alongside L5 if both exist and differ meaningfully */}
      {last5Avg != null && seasonAvg != null && Math.abs(last5Avg - seasonAvg) > 0.5 && (
        <span style={{ color: '#444', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
          (Szn {seasonAvg.toFixed(1)})
        </span>
      )}
    </span>
  )
}
