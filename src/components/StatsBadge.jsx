export default function StatsBadge({ seasonAvg, last5Avg, line }) {
  if (seasonAvg == null && last5Avg == null) return null

  function color(avg) {
    if (avg == null) return '#888'
    return avg >= line ? 'var(--green)' : 'var(--red)'
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, fontSize: 10, lineHeight: 1 }}>
      {seasonAvg != null && (
        <span style={{
          background: '#222', border: `1px solid ${color(seasonAvg)}`,
          color: color(seasonAvg), borderRadius: 4, padding: '2px 5px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Szn {seasonAvg.toFixed(1)}
        </span>
      )}
      {last5Avg != null && (
        <span style={{
          background: '#222', border: `1px solid ${color(last5Avg)}`,
          color: color(last5Avg), borderRadius: 4, padding: '2px 5px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          L5 {last5Avg.toFixed(1)}
        </span>
      )}
    </span>
  )
}
