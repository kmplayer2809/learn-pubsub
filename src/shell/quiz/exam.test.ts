import { describe, expect, it } from 'vitest'
import { EXAM_QUESTION_COUNT, buildExam, type ExamSource } from './exam'

function source(id: string, title: string, n: number): ExamSource {
  return {
    id,
    title,
    quiz: Array.from({ length: n }, (_, i) => ({
      question: `Câu ${i} của ${id}?`,
      options: ['Một', 'Hai', 'Ba'],
      answerIndex: i % 3,
      explanation: `Giải thích câu ${i} của ${id}.`,
    })),
  }
}

const lessons = [source('01-a', 'Bài A', 10), source('02-b', 'Bài B', 10), source('03-c', 'Bài C', 10)]

describe('buildExam', () => {
  it('draws EXAM_QUESTION_COUNT questions by default', () => {
    expect(buildExam(lessons, 42)).toHaveLength(EXAM_QUESTION_COUNT)
    expect(EXAM_QUESTION_COUNT).toBe(20)
  })

  // Every wrong answer links back to the lesson that teaches it, so the source has to
  // travel with the question rather than be looked up afterwards.
  it('tags each question with its source lesson', () => {
    for (const question of buildExam(lessons, 42)) {
      const origin = lessons.find((l) => l.id === question.lessonId)!
      expect(origin.title).toBe(question.lessonTitle)
      expect(origin.quiz!.some((q) => q.question === question.question)).toBe(true)
    }
  })

  it('draws from more than one lesson', () => {
    const ids = new Set(buildExam(lessons, 42).map((q) => q.lessonId))
    expect(ids.size).toBeGreaterThan(1)
  })

  it('gives the same exam for the same seed and a different one otherwise', () => {
    expect(buildExam(lessons, 42)).toEqual(buildExam(lessons, 42))
    expect(buildExam(lessons, 42)).not.toEqual(buildExam(lessons, 43))
  })

  it('never repeats a question inside one exam', () => {
    const exam = buildExam(lessons, 7)
    expect(new Set(exam.map((q) => `${q.lessonId}|${q.question}`)).size).toBe(exam.length)
  })

  it('returns the whole bank when it is smaller than the requested count', () => {
    expect(buildExam([source('01-a', 'Bài A', 3)], 42)).toHaveLength(3)
  })

  it('skips lessons with no quiz and returns empty when nothing has one', () => {
    expect(buildExam([{ id: '01-a', title: 'Bài A' }], 42)).toEqual([])
  })

  it('honours an explicit count', () => {
    expect(buildExam(lessons, 42, 5)).toHaveLength(5)
  })
})
