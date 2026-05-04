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

export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []

  const pool = [...projections]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, Math.min(20, projections.length))

  return combinations(pool, legCount)
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
