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

export function estimateProb(attrs) {
  let p = 0.54
  if (attrs.is_promo) p += 0.04
  if (attrs.odds_type === 'demon') p -= 0.03
  if (attrs.odds_type === 'goblin') p += 0.06
  const frac = attrs.line_score % 1
  if (frac >= 0.4 && frac <= 0.6) p += 0.01
  return Math.min(0.74, Math.max(0.46, p))
}
