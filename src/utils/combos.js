import { calcEV, isLock, isLineGoblin } from './ev.js'

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

// Goblin bonus slots appended to each slip after the standard foundation.
// [min, max] — we generate combos for every count in this range and sort by jointProb.
const GOBLIN_SLOTS = { 2: [1, 1], 3: [1, 1], 4: [1, 2], 5: [1, 2], 6: [1, 2] }

function isGoblinProp(p) {
  return p.oddsType === 'goblin' || isLineGoblin(p.line, p.league, p.statType)
}

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
// goblins fill 1–2 bonus tail slots per slip.
// Standard pool is sorted descending by probability by the caller.
// Falls back to pure-standard combos when no goblins are available.
export function bestCombos(projections, legCount, limit = 5) {
  if (projections.length < legCount) return []

  const pool      = projections.slice(0, Math.min(30, projections.length))
  const locks     = pool.filter(p => isLock(p.line, p.statType))
  const goblins   = pool.filter(p => !isLock(p.line, p.statType) && isGoblinProp(p))
  const standards = pool.filter(p => !isLock(p.line, p.statType) && !isGoblinProp(p))

  if (standards.length < 3) {
    console.warn(`[combos] Only ${standards.length} standard props available — building with what's here`)
  }

  // LOCKs are near-certain and may fill any foundation slot alongside standards.
  const stdPool = [...locks, ...standards].slice(0, 20)
  const gobPool = goblins.slice(0, 10)

  const [minGob, maxGob] = GOBLIN_SLOTS[legCount] ?? [1, 2]

  // Build candidate pick arrays: every combo of stdSlots standards × gobSlots goblins.
  const allPicks = []
  for (let gobSlots = minGob; gobSlots <= maxGob; gobSlots++) {
    const stdSlots = legCount - gobSlots
    if (stdPool.length < stdSlots || gobPool.length < gobSlots) continue
    const stdCombos = combinations(stdPool, stdSlots)
    const gobCombos = combinations(gobPool, gobSlots)
    for (const sc of stdCombos) {
      for (const gc of gobCombos) {
        allPicks.push([...sc, ...gc])
      }
    }
  }

  // No goblins today — fall back to pure-standard combos.
  const source = allPicks.length > 0 ? allPicks : combinations(stdPool, legCount)

  const scored = source
    .filter(isValidSlip)
    .map(picks => {
      const goblinCount = picks.filter(p => p.oddsType === 'goblin').length
      const jointProb   = picks.reduce((acc, p) => acc * p.probability, 1) * correlationFactor(picks)
      const perLegAvg   = Math.pow(jointProb, 1 / legCount)
      const ev          = calcEV(perLegAvg, legCount, goblinCount)
      return { picks, ev, jointProb, goblinCount }
    })
    .sort((a, b) => b.jointProb - a.jointProb)

  return pickResult(scored, limit)
}
