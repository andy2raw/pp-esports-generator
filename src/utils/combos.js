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
// Players from opposing teams in the same match can be combined freely.
function isValidSlip(picks) {
  const seen = new Set()
  for (const p of picks) {
    if (!p.team) continue
    if (seen.has(p.team)) return false
    seen.add(p.team)
  }
  return true
}

// Caller must pre-sort projections in desired priority order.
// Pool is the top-N from that ordered list.
export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []

  const pool = projections.slice(0, Math.min(20, projections.length))

  return combinations(pool, legCount)
    .filter(isValidSlip)
    .map(picks => {
      const goblinCount = picks.filter(p => p.oddsType === 'goblin').length
      const jointProb = picks.reduce((acc, p) => acc * p.probability, 1)
      const perLegAvg = Math.pow(jointProb, 1 / legCount)
      const ev = calcEV(perLegAvg, legCount, goblinCount)
      return { picks, ev, jointProb, goblinCount }
    })
    .sort((a, b) => b.ev - a.ev)
    .slice(0, limit)
}
