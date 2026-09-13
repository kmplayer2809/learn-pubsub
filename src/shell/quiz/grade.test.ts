import { describe, expect, it } from 'vitest'
import type { QuizQuestion } from '../lesson/types'
import { gradeQuiz } from './grade'

const questions: QuizQuestion[] = [
  {
    question: 'Exchange nào gửi bản sao tới mọi queue đã bind?',
    options: ['Direct', 'Fanout', 'Topic'],
    answerIndex: 1,
    explanation: 'Fanout bỏ qua routing key và gửi tới mọi queue đã bind.',
  },
  {
    question: '`prefetch: 1` giới hạn điều gì?',
    options: ['Số message chưa ack mỗi consumer', 'Số queue mỗi kênh', 'Kích thước message'],
    answerIndex: 0,
    explanation: 'Prefetch đếm message đã đẩy đi mà chưa được ack.',
  },
]

describe('gradeQuiz', () => {
  it('counts every matching answerIndex', () => {
    expect(gradeQuiz(questions, [1, 0])).toEqual({ correct: 2, total: 2, wrongIndexes: [] })
  })

  it('reports the position of each wrong answer', () => {
    expect(gradeQuiz(questions, [0, 0])).toEqual({ correct: 1, total: 2, wrongIndexes: [0] })
  })

  // A learner who closes the dialog half-answered must not be told they scored
  // 1/1 on the half they did answer — the denominator is the whole quiz.
  it('treats an unanswered question as wrong', () => {
    expect(gradeQuiz(questions, [1, undefined])).toEqual({
      correct: 1,
      total: 2,
      wrongIndexes: [1],
    })
    expect(gradeQuiz(questions, [])).toEqual({ correct: 0, total: 2, wrongIndexes: [0, 1] })
  })

  it('scores an empty quiz as zero of zero', () => {
    expect(gradeQuiz([], [])).toEqual({ correct: 0, total: 0, wrongIndexes: [] })
  })
})
