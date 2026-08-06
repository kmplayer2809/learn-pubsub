import type { Lesson, LessonGroup } from './types'
import { helloWorld } from './01-hello-world'

export const LESSON_GROUPS: { id: LessonGroup; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'dlx', label: 'Dead-lettering & retry' },
  { id: 'patterns', label: 'Patterns' },
]

export const LESSONS: Lesson[] = [helloWorld]

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function lessonsByGroup(group: LessonGroup): Lesson[] {
  return LESSONS.filter((l) => l.group === group)
}
