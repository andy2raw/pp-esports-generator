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

// Two players share a match if they have the same league + startTime.
// PrizePicks rules prohibit combining players from the same match.
function isValidSlip(picks) {
  const seen = new Set()
  for (const p of picks) {
    const key = `${p.league}:${p.startTime}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []

  const pool = [...projections]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, Math.min(20, projections.length))

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

// Groups projections by match (league + startTime), sorted by start time.
// Each group has the players ranked by probability so the user knows
// which single player to pick from that match.
export function groupByMatch(projections) {
  const groups = new Map()
  for (const p of projections) {
    const key = `${p.league}:${p.startTime}`
    if (!groups.has(key)) {
      groups.set(key, { key, league: p.league, startTime: p.startTime, picks: [] })
    }
    groups.get(key).picks.push(p)
  }
  for (const g of groups.values()) {
    g.picks.sort((a, b) => b.probability - a.probability)
  }
  return [...groups.values()].sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
}
