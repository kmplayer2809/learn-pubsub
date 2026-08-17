import type { Lesson } from '../../../shell/lesson/types'
import type { RedisFault, RedisScriptedCommand, RedisTopology } from '../engine'

export type { RedisFault } from '../engine'

export type RedisLessonGroup = 'basics' | 'cache' | 'messaging' | 'advanced'

/**
 * Narrows the base `Lesson`'s open `group: string` to the four groups this
 * broker declares, so a lesson filed under a group the sidebar does not render
 * is a compile error rather than a lesson nobody can reach.
 */
export interface RedisLesson extends Lesson<RedisTopology, RedisScriptedCommand> {
  group: RedisLessonGroup
  /** Named `failures` (not `faults`) on purpose — `src/shell/useSimulation.ts`
   *  reads any lesson's `.failures` field generically to pass into
   *  `createSimulation`, and that mechanism is what keeps `src/shell/`
   *  broker-agnostic. See the design doc's "Deviation" note for why. */
  failures?: RedisFault[]
}

/**
 * The topology every lesson shares unless its own file says otherwise. Exported
 * as frozen singletons rather than a factory: `createSimulation` treats the
 * topology as immutable input, and one shared object across every lesson is the
 * cheapest way to keep that honest — a lesson that mutated it would break every
 * other lesson loudly instead of only itself.
 */
export const APP = Object.freeze({ id: 'app', label: 'App', position: { x: 40, y: 120 } })
export const WORKER = Object.freeze({ id: 'worker', label: 'Worker', position: { x: 40, y: 280 } })
export const SERVER = Object.freeze({ id: 'redis', label: 'Redis', position: { x: 380, y: 200 } })
