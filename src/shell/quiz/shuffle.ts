import { createRng, nextInt } from '../kernel/rng'

/**
 * Fisher-Yates driven by the kernel's mulberry32 rather than `Math.random`. The quiz UI
 * is outside the purity guard, but reusing the one rng in the repo means a shuffle is
 * reproducible from its seed and the tests can assert an exact order.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let rng = createRng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(rng, i + 1)
    rng = next
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/** `count` elements drawn without replacement. Returns the whole pool if it is smaller. */
export function sample<T>(items: readonly T[], count: number, seed: number): T[] {
  return shuffle(items, seed).slice(0, count)
}
