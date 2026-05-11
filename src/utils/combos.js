import { calcEV } from './ev.js'

function combinations(arr, k) {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  return [
    ...combinations(tail, k - 1).map(c => [head, ...c]),
    ...combinations(tail, k),
  ]
}

// Only reject picks where two players share the exact same team name.
function isValidSlip(picks) {
  const seen = new Set()
  for (const p of picks) {
    if (!p.team) continue
    if (seen.has(p.team)) return false
    seen.add(p.team)
  }
  return true
}

// 15% joint-probability penalty per same-team pair in a combo.
function correlationFactor(picks) {
  let pairs = 0
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      if (picks[i].team && picks[j].team && picks[i].team === picks[j].team) pairs++
    }
  }
  return Math.pow(0.85, pairs)
}

const MAX_PLAYER_APPEARANCES = 2

// Build the best combos by maximizing joint win probability.
// Pool must already be sorted in descending probability order by the caller.
// Each player appears in at most MAX_PLAYER_APPEARANCES combos for variety.
export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []
  const pool = projections.slice(0, Math.min(30, projections.length))

  const scored = combinations(pool, legCount)
    .filter(isValidSlip)
    .map(picks => {
      const goblinCount = picks.filter(p => p.oddsType === 'goblin').length
      const jointProb   = picks.reduce((acc, p) => acc * p.probability, 1) * correlationFactor(picks)
      const perLegAvg   = Math.pow(jointProb, 1 / legCount)
      const ev          = calcEV(perLegAvg, legCount, goblinCount)
      return { picks, ev, jointProb, goblinCount }
    })
    .sort((a, b) => b.jointProb - a.jointProb)

  const appearances = {}
  const result = []
  for (const combo of scored) {
    if (result.length >= limit) break
    const overLimit = combo.picks.some(
      p => (appearances[p.playerName] ?? 0) >= MAX_PLAYER_APPEARANCES,
    )
    if (overLimit) continue
    result.push(combo)
    for (const p of combo.picks) {
      appearances[p.playerName] = (appearances[p.playerName] ?? 0) + 1
    }
  }
  return result
}
