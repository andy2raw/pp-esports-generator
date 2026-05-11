export const PP_MULTIPLIERS = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 25 }

export const GOBLIN_MULTIPLIERS = {
  2: { 1: 1.75, 2: 1.75 },
  3: { 1: 3.00, 2: 2.25, 3: 2.25 },
  4: { 1: 6.00, 2: 4.50, 3: 3.38, 4: 3.38 },
  5: { 1: 12.0, 2: 9.00, 3: 6.75, 4: 5.06, 5: 5.06 },
  6: { 1: 15.0, 2: 11.25, 3: 8.44, 4: 6.33, 5: 4.75, 6: 4.75 },
}

export function getEffectiveMult(legCount, goblinCount) {
  const leg = Math.min(Math.max(legCount, 2), 6)
  const gob = Math.min(Math.max(goblinCount, 0), leg)
  if (gob === 0) return PP_MULTIPLIERS[leg]
  return GOBLIN_MULTIPLIERS[leg]?.[gob] ?? PP_MULTIPLIERS[leg]
}

export function calcEV(probability, legCount, goblinCount = 0) {
  const mult = getEffectiveMult(legCount, goblinCount)
  return Math.pow(probability, legCount) * mult - 1
}

export function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`
}

export function fmtEV(v) {
  const pct = (v * 100).toFixed(1)
  return v >= 0 ? `+${pct}%` : `${pct}%`
}

export function probColor(p) {
  if (p >= 0.65) return 'var(--green)'
  if (p >= 0.57) return 'var(--yellow)'
  if (p >= 0.52) return 'var(--orange)'
  return 'var(--red)'
}

// Line-realism score (4–8, never 5) used when no stats data is available.
// Compares the PrizePicks line to typical esports map averages to judge
// whether the line is easy, fair, or tough.
function lineBasedConfidence(picks) {
  const scores = picks.map(p => {
    const st = (p.statType || '').toLowerCase()
    const line = p.line || 0

    if (st.includes('kill')) {
      const isMultiMap = st.includes('1-2') || st.includes('1-3') || st.includes('combo')
      if (isMultiMap) {
        // MAP 1-2 / combo: typical range 20–40 kills
        if (line < 16) return 8
        if (line < 22) return 7
        if (line < 32) return 6
        return 4
      } else {
        // Single-player per-map: typical range 8–18
        if (line < 7)  return 8
        if (line < 11) return 7
        if (line < 17) return 6
        return 4
      }
    }
    if (st.includes('assist')) return line < 8  ? 7 : line < 15 ? 6 : 4
    if (st.includes('death'))  return line < 10 ? 7 : line < 16 ? 6 : 4
    if (st.includes('headshot')) return line < 35 ? 7 : line < 46 ? 6 : 4
    return 6 // default: slightly above neutral, avoids 5
  })
  const raw = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.max(1, Math.min(10, Math.round(raw)))
}

// Confidence score 1–10 combining hit probability, stats trend, player history.
// Falls back to line-based scoring when no external data is available.
export function calcConfidence(combo, getStatLine, playerHistory) {
  const { picks } = combo
  if (!picks?.length) return 6

  // 1) Average per-leg hit probability, normalised to 0–1 over [0.46, 0.74]
  const avgProb = picks.reduce((s, p) => s + p.probability, 0) / picks.length
  const probScore = Math.max(0, Math.min(1, (avgProb - 0.46) / 0.28))

  // 2) Stats trend: fraction of picks where L5/season avg meets the line
  const trendValues = picks.map(p => {
    const sl = getStatLine(p.playerName, p.league, p.statType)
    const a = sl?.last5Avg ?? sl?.seasonAvg ?? null
    if (a === null) return null
    return a >= p.line ? 1 : a >= p.line - 2 ? 0.5 : 0
  }).filter(v => v !== null)

  // 3) Player history win-rate (requires ≥2 settled slips per player)
  const histValues = picks.map(p => {
    const h = playerHistory[p.playerName]
    return h && h.hits + h.misses >= 2 ? h.hits / (h.hits + h.misses) : null
  }).filter(v => v !== null)

  // If neither stats nor history is available, skip the composite and use
  // the line-based heuristic directly — it never returns 5.
  if (trendValues.length === 0 && histValues.length === 0) {
    return lineBasedConfidence(picks)
  }

  const trendScore = trendValues.length
    ? trendValues.reduce((a, b) => a + b, 0) / trendValues.length
    : (lineBasedConfidence(picks) - 1) / 9  // convert 1-10 → 0-1 when partially missing

  const histScore = histValues.length
    ? histValues.reduce((a, b) => a + b, 0) / histValues.length
    : 0.5

  const composite = probScore * 0.5 + trendScore * 0.3 + histScore * 0.2
  const score = Math.max(1, Math.min(10, Math.round(composite * 9 + 1)))
  // Nudge off exactly 5 when data is partial to signal "no strong signal"
  return score === 5 ? (trendValues.length > 0 ? 6 : 4) : score
}

// A kills line under 1.0 is a near-certain over (e.g. O0.5 — player must get 0 kills).
// Display as LOCK (blue) rather than GOBLIN (green).
export function isLock(line, statType) {
  return (statType || '').toLowerCase().includes('kill') && line < 1
}

// Source of truth: PrizePicks oddsType field.
// Falls back to line-based detection only when oddsType is absent/null.
export function isGoblin(p) {
  if (p.oddsType) return p.oddsType === 'goblin'
  return isLineGoblin(p.line, p.league, p.statType)
}

// Returns true when a Kills line is set so low it's statistically easy to go over.
// These are prime "goblin line" targets regardless of PrizePicks odds type.
export function isLineGoblin(line, game, statType) {
  if (!(statType || '').toLowerCase().includes('kill')) return false
  const g = (game || '').toUpperCase()
  const isMultiMap = /1-2|1-3|combo/i.test(statType)
  const single = { CSGO: 14, CS2: 14, VAL: 15, LOL: 5, DOTA2: 8 }[g]
  if (!single) return false
  return line < (isMultiMap ? single * 1.8 : single)
}

export function estimateProb(attrs) {
  let p = 0.54
  if (attrs.is_promo) p += 0.04
  if (attrs.odds_type === 'demon') p -= 0.03
  if (attrs.odds_type === 'goblin') p += 0.06
  const frac = attrs.line_score % 1
  if (frac >= 0.4 && frac <= 0.6) p += 0.01
  return Math.min(0.74, Math.max(0.46, p))
}
