import type { Lesson, LessonGroup } from './types'
import { helloWorld } from './01-hello-world'
import { directExchange } from './02-direct'
import { fanoutExchange } from './03-fanout'
import { topicExchange } from './04-topic'
import { headersExchange } from './05-headers'
import { competingConsumers } from './06-competing-consumers'
import { ackModes } from './07-ack-modes'
import { prefetchQos } from './08-prefetch'
import { nackRequeue } from './09-nack-requeue'
import { dlxBasics } from './11-dlx'
import { ttlAndMaxLength } from './12-ttl-maxlen'
import { retryWithBackoff } from './13-retry-backoff'

export const LESSON_GROUPS: { id: LessonGroup; label: string }[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'reliability', label: 'Độ tin cậy' },
  { id: 'dlx', label: 'Dead-letter & retry' },
  { id: 'patterns', label: 'Pattern nâng cao' },
]

export const LESSONS: Lesson[] = [
  helloWorld,
  directExchange,
  fanoutExchange,
  topicExchange,
  headersExchange,
  competingConsumers,
  ackModes,
  prefetchQos,
  nackRequeue,
  dlxBasics,
  ttlAndMaxLength,
  retryWithBackoff,
]

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function lessonsByGroup(group: LessonGroup): Lesson[] {
  return LESSONS.filter((l) => l.group === group)
}
