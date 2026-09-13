import type { QuizQuestion } from '../lesson/types'
import { sample } from './shuffle'

/**
 * Twenty for every broker, not a fraction of each bank: enough that guessing shows, short
 * enough to finish in one sitting. RabbitMQ and Redis hold ~68 questions and Kafka ~100,
 * so each sitting draws a different exam.
 */
export const EXAM_QUESTION_COUNT = 20

/** The shape `buildExam` needs from a lesson — structurally satisfied by `Lesson`. */
export interface ExamSource {
  id: string
  title: string
  quiz?: QuizQuestion[]
}

/** A quiz question that remembers where it came from, so a miss can link back to the lesson. */
export interface ExamQuestion extends QuizQuestion {
  lessonId: string
  lessonTitle: string
}

/**
 * Flattens every lesson's quiz into one bank and draws from it. Drawing from the flat
 * bank rather than per lesson keeps the mix proportional — a broker's longer chapters
 * carry more questions and so show up more often, which is what a final exam should do.
 */
export function buildExam(
  lessons: readonly ExamSource[],
  seed: number,
  count: number = EXAM_QUESTION_COUNT,
): ExamQuestion[] {
  const bank: ExamQuestion[] = lessons.flatMap((lesson) =>
    (lesson.quiz ?? []).map((question) => ({
      ...question,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
    })),
  )
  return sample(bank, count, seed)
}
