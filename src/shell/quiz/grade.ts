import type { QuizQuestion } from '../lesson/types'

export interface QuizResult {
  correct: number
  total: number
  /** Positions in the array passed to `gradeQuiz`, which may be shuffled — not positions
   *  in the lesson's own `quiz` array. */
  wrongIndexes: number[]
}

/**
 * Pure scoring, no knowledge of React, broker or storage. `answers[i] === undefined`
 * means the learner never picked an option, and counts as wrong: the quiz reports a
 * score out of every question asked, not out of the ones attempted.
 */
export function gradeQuiz(
  questions: QuizQuestion[],
  answers: (number | undefined)[],
): QuizResult {
  const wrongIndexes: number[] = []
  questions.forEach((question, i) => {
    if (answers[i] !== question.answerIndex) wrongIndexes.push(i)
  })
  return {
    correct: questions.length - wrongIndexes.length,
    total: questions.length,
    wrongIndexes,
  }
}
