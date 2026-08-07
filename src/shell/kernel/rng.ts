export interface RngState {
  readonly s: number
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 }
}

/** mulberry32, expressed as a pure step so engine state stays immutable. */
export function nextFloat(rng: RngState): [number, RngState] {
  let t = (rng.s + 0x6d2b79f5) >>> 0
  let r = t
  r = Math.imul(r ^ (r >>> 15), r | 1)
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296
  return [value, { s: t }]
}

export function nextInt(rng: RngState, maxExclusive: number): [number, RngState] {
  const [f, next] = nextFloat(rng)
  return [Math.floor(f * maxExclusive), next]
}
