import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../engine'
import type { RedisLesson } from './types'
import { strings } from './01-strings'

function run(lesson: RedisLesson, upTo: number) {
  const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
  sim.advanceTo(upTo)
  return sim.snapshot()
}

describe('01 strings', () => {
  it('counts INCR to 2 and counts exactly the one genuine miss (GET user:2), not the writes that also touch a missing key', () => {
    // keyspace_hits/misses move on the read path only (readKey's `intent`).
    // SET user:1 and both INCR page:views calls go through readKey with
    // intent 'write', so none of them count as a miss even though the first
    // SET and the first INCR each look up a key that isn't there yet. Only
    // `GET user:2` is a read against a key that never exists.
    const state = run(strings, 10_000)
    expect(state.keys['page:views']!.value).toEqual({ type: 'string', value: '2' })
    expect(state.metrics.misses).toBe(1)
  })
})
