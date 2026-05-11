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

// Average probability of non-goblin picks (or all picks if none exist).
// Used to rank combos within the same goblin tier.
function cleanScore(combo) {
  const nonGob = combo.picks.filter(p => p.oddsType !== 'goblin')
  const src = nonGob.length ? nonGob : combo.picks
  return src.reduce((s, p) => s + p.probability, 0) / src.length
}

// Maximum goblin props allowed per leg count.
const MAX_GOBLINS = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 }
const MAX_PLAYER_APPEARANCES = 2

export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []
  const maxGob = MAX_GOBLINS[legCount] ?? 2
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
    .filter(c => c.goblinCount <= maxGob)
    // Cleanest slips first: fewest goblins, then highest quality standard picks.
    // Goblin-heavy slips naturally fall to the end.
    .sort((a, b) => a.goblinCount - b.goblinCount || cleanScore(b) - cleanScore(a))

  // Greedy rotation: each player appears in at most MAX_PLAYER_APPEARANCES combos.
  const appearances = {}
  const result = []
  let hasClean = false

  for (const combo of scored) {
    if (result.length >= limit) break
    const overLimit = combo.picks.some(
      p => (appearances[p.playerName] ?? 0) >= MAX_PLAYER_APPEARANCES,
    )
    if (overLimit) continue
    result.push(combo)
    if (combo.goblinCount === 0) hasClean = true
    for (const p of combo.picks) {
      appearances[p.playerName] = (appearances[p.playerName] ?? 0) + 1
    }
  }

  // Guarantee at least one clean slip (0 goblins) per type when one exists.
  // If the rotation excluded all clean combos, find the best one and prepend it.
  if (!hasClean) {
    const bestClean = scored.find(c => c.goblinCount === 0)
    if (bestClean) {
      if (result.length >= limit) result.pop()
      result.unshift(bestClean)
    }
  }

  return result
}
