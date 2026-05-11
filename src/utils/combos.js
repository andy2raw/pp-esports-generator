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

function isValidSlip(picks) {
  const seen = new Set()
  for (const p of picks) {
    if (!p.team) continue
    if (seen.has(p.team)) return false
    seen.add(p.team)
  }
  return true
}

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
const MAX_GOBLINS = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 }

// sharedAppearances allows coordinated rotation across multiple bestCombos calls
// so no player appears more than MAX_PLAYER_APPEARANCES times across all slips.
function pickResult(scored, limit, appearances) {
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

export function bestCombos(projections, legCount, limit = 5, sharedAppearances = null) {
  if (projections.length < legCount) return []

  // Expanded to 50 for more variety
  const pool      = projections.slice(0, Math.min(50, projections.length))
  const locks     = pool.filter(p => isLock(p.line, p.statType))
  const goblins   = pool.filter(p => !isLock(p.line, p.statType) && isGoblin(p))
  const standards = pool.filter(p => !isLock(p.line, p.statType) && !isGoblin(p))

  if (standards.length < 3) {
    console.warn(`[combos] Only ${standards.length} standard props — filling with best available`)
  }

  const stdPool = [...locks, ...standards].slice(0, 25)
  const gobPool = goblins.slice(0, 12)
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

  const appearances = sharedAppearances ?? {}

  let candidates = buildCandidates(maxGob)
  if (candidates.length === 0) candidates = buildCandidates(legCount)
  if (candidates.length === 0) candidates = combinations(pool.slice(0, 25), legCount)

  const result = pickResult(scoreAndSort(candidates), limit, appearances)

  if (result.length < limit) {
    return pickResult(scoreAndSort(combinations(pool.slice(0, 25), legCount)), limit, appearances)
  }

  return result
}
