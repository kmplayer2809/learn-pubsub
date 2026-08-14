import type { LessonGroupSpec } from '../../../shell/lesson/types'
import type { RedisLesson } from './types'
import { strings } from './01-strings'
import { hash } from './02-hash'
import { list } from './03-list'
import { set } from './04-set'
import { zset } from './05-zset'
import { ttl } from './06-ttl'
import { scan } from './07-scan'
import { cacheAside } from './08-cache-aside'
import { writeThrough } from './09-write-through'
import { stampede } from './10-stampede'
import { eviction } from './11-eviction'

/**
 * `messaging` and `advanced` carry no lessons until the next plan. That is
 * deliberate and the cross-lesson suite allows it: it asserts every lesson's
 * group is declared here, not that every declared group has a lesson.
 */
export const REDIS_LESSON_GROUPS: LessonGroupSpec[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'cache', label: 'Cache' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'advanced', label: 'Nâng cao' },
]

/** Sidebar order, which is also teaching order: each lesson assumes the ones above it. */
export const LESSONS: RedisLesson[] = [
  strings,
  hash,
  list,
  set,
  zset,
  ttl,
  scan,
  cacheAside,
  writeThrough,
  stampede,
  eviction,
]
