import { describe, expect, it } from 'vitest'
import { BROKERS } from '../../brokers/registry'

/**
 * Every lesson ends with a graded quiz — a product rule, not a per-broker choice, so it
 * is enforced here across `BROKERS` rather than in each broker's own `lessons.test.ts`.
 * A broker added later is covered the moment it is registered.
 *
 * Four questions: enough that a lucky guess does not read as understanding, few enough to
 * sit through after a lesson. Unlike `checkpoints`, quiz questions carry no `at` — they
 * are also drawn into the per-broker exam, where no run is playing behind them.
 */
describe.each(BROKERS.map((b) => [b.id, b] as const))('%s: every lesson ends with a quiz', (
  _brokerId,
  broker,
) => {
  it.each(broker.lessons.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
    const quiz = lesson.quiz ?? []
    expect(quiz.length, `${lesson.id} needs at least 4 quiz questions`).toBeGreaterThanOrEqual(4)

    for (const question of quiz) {
      // A quiz whose options are all correct-looking duplicates teaches nothing.
      expect(question.options.length, `${lesson.id}: "${question.question}"`).toBeGreaterThanOrEqual(3)
      expect(
        new Set(question.options).size,
        `${lesson.id}: "${question.question}" has duplicate options`,
      ).toBe(question.options.length)

      // An answerIndex out of range renders a quiz nobody can get right.
      expect(question.answerIndex, `${lesson.id}: "${question.question}"`).toBeGreaterThanOrEqual(0)
      expect(question.answerIndex, `${lesson.id}: "${question.question}"`).toBeLessThan(
        question.options.length,
      )

      expect(question.explanation.length, `${lesson.id}: "${question.question}" has no explanation`)
        .toBeGreaterThan(0)
    }

    // The exam draws from the flat bank, so a question repeated inside one lesson can
    // surface twice in one exam.
    const questions = quiz.map((q) => q.question)
    expect(new Set(questions).size, `${lesson.id} asks the same question twice`).toBe(questions.length)

    // Checkpoints and quiz serve different beats; copying one into the other wastes both.
    const checkpointQuestions = new Set((lesson.checkpoints ?? []).map((c) => c.question))
    for (const question of questions) {
      expect(checkpointQuestions.has(question), `${lesson.id} reuses a checkpoint question in its quiz`)
        .toBe(false)
    }
  })
})
