export function poissonProbability(lambda, k) {
  if (lambda <= 0) return 0
  let logP = -lambda + k * Math.log(lambda) - logFactorial(k)
  return Math.exp(logP)
}

function logFactorial(n) {
  if (n <= 1) return 0
  let result = 0
  for (let i = 2; i <= n; i++) result += Math.log(i)
  return result
}

export function poissonCDF(lambda, k) {
  let cumulative = 0
  for (let i = 0; i <= Math.floor(k); i++) {
    cumulative += poissonProbability(lambda, i)
  }
  return Math.min(cumulative, 1)
}

export function poissonOverProb(lambda, line) {
  return 1 - poissonCDF(lambda, Math.floor(line))
}

export function poissonUnderProb(lambda, line) {
  return poissonCDF(lambda, Math.floor(line))
}
