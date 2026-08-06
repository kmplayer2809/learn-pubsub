import type { Lesson, LessonGroup } from './types'
import { helloWorld } from './01-hello-world'
import { directExchange } from './02-direct'
import { fanoutExchange } from './03-fanout'
import { topicExchange } from './04-topic'
import { headersExchange } from './05-headers'
import { competingConsumers } from './06-competing-consumers'

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
]

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function lessonsByGroup(group: LessonGroup): Lesson[] {
  return LESSONS.filter((l) => l.group === group)
}
