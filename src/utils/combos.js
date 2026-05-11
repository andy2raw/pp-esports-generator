import { calcEV, isLock, isGoblin } from './ev.js'

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

// Max goblin props per slip (0 = no goblins required, these are ceilings only).
// Standards form the foundation; goblins can fill remaining slots up to the cap.
const MAX_GOBLINS = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 }

function pickResult(scored, limit) {
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

// Build the best combos: standard (+ lock) props form the foundation;
// goblins fill bonus slots up to MAX_GOBLINS[legCount].
// Slips are sorted by joint probability descending — highest-winProb props rise naturally.
//
// Fallback ladder — sections are never empty:
//   1. Preferred: stdPool × gobPool with gobSlots in [0, maxGob]
//   2. Relaxed:   expand goblin budget up to legCount when standards are scarce
//   3. Full pool: unrestricted combinations from all props
//
// Player rotation (MAX_PLAYER_APPEARANCES) applied after scoring.
export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []

  const pool      = projections.slice(0, Math.min(30, projections.length))
  const locks     = pool.filter(p => isLock(p.line, p.statType))
  const goblins   = pool.filter(p => !isLock(p.line, p.statType) && isGoblin(p))
  const standards = pool.filter(p => !isLock(p.line, p.statType) && !isGoblin(p))

  if (standards.length < 3) {
    console.warn(`[combos] Only ${standards.length} standard props — filling remaining slots with best available`)
  }

  // LOCKs are near-certain and may fill any foundation slot.
  const stdPool = [...locks, ...standards].slice(0, 20)
  const gobPool = goblins.slice(0, 10)
  const maxGob  = MAX_GOBLINS[legCount] ?? Math.floor(legCount / 2)

  function buildCandidates(gobCeiling) {
    const picks = []
    for (let gobSlots = 0; gobSlots <= gobCeiling; gobSlots++) {
      const stdSlots = legCount - gobSlots
      if (stdPool.length < stdSlots || gobPool.length < gobSlots) continue
      for (const sc of combinations(stdPool, stdSlots)) {
        for (const gc of combinations(gobPool, gobSlots)) {
          picks.push([...sc, ...gc])
        }
      }
    }
    return picks
  }

  function scoreAndSort(pickArrays) {
    return pickArrays
      .filter(isValidSlip)
      .map(combo => {
        const goblinCount = combo.filter(p => p.oddsType === 'goblin').length
        const jointProb   = combo.reduce((acc, p) => acc * p.probability, 1) * correlationFactor(combo)
        const perLegAvg   = Math.pow(jointProb, 1 / legCount)
        const ev          = calcEV(perLegAvg, legCount, goblinCount)
        return { picks: combo, ev, jointProb, goblinCount }
      })
      .sort((a, b) => b.jointProb - a.jointProb)
  }

  // Fallback ladder: preferred → relaxed → full pool.
  let candidates = buildCandidates(maxGob)
  if (candidates.length === 0) candidates = buildCandidates(legCount)
  if (candidates.length === 0) candidates = combinations(pool.slice(0, 25), legCount)

  const result = pickResult(scoreAndSort(candidates), limit)

  // If player rotation still leaves us short, retry with unrestricted full pool.
  if (result.length < limit) {
    return pickResult(scoreAndSort(combinations(pool.slice(0, 25), legCount)), limit)
  }

  return result
}
