import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, validateKafkaTopology } from '../engine'
import { KAFKA_LESSON_GROUPS, LESSONS } from './registry'

describe('mọi lesson Kafka', () => {
  it('có ít nhất một lesson', () => {
    expect(LESSONS.length).toBeGreaterThan(0)
  })

  it('id không trùng nhau', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: topology không có issue mức error', (_id, lesson) => {
    const errors = validateKafkaTopology(lesson.topology, lesson.script).filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: chạy xác định', (_id, lesson) => {
    const run = () => {
      const sim = createKafkaSimulation({
        topology: lesson.topology, script: lesson.script, seed: lesson.seed, failures: lesson.failures,
      })
      sim.advanceTo(lesson.durationMs + 5000)
      return JSON.stringify(sim.snapshot().journal)
    }
    expect(run()).toBe(run())
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: group đã khai báo trong registry', (_id, lesson) => {
    expect(KAFKA_LESSON_GROUPS.map((g) => g.id)).toContain(lesson.group)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: narrative xếp theo thời gian tăng dần', (_id, lesson) => {
    const times = lesson.narrative.map((s) => s.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: mọi mốc narrative nằm trong durationMs', (_id, lesson) => {
    for (const step of lesson.narrative) expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: mọi node được highlight đều tồn tại', (_id, lesson) => {
    const ids = new Set([
      ...lesson.topology.brokers.map((b) => b.id),
      ...lesson.topology.producers.map((p) => p.id),
      ...lesson.topology.consumers.map((c) => c.id),
      ...lesson.topology.topics.flatMap((t) =>
        Array.from({ length: t.partitions }, (_, i) => `${t.name}-${i}`),
      ),
    ])
    for (const step of lesson.narrative) {
      for (const nodeId of step.highlight ?? []) expect(ids).toContain(nodeId)
    }
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: không run nào bị halt', (_id, lesson) => {
    const sim = createKafkaSimulation({
      topology: lesson.topology, script: lesson.script, seed: lesson.seed, failures: lesson.failures,
    })
    sim.advanceTo(lesson.durationMs + 5000)
    expect(sim.snapshot().halted).toBeUndefined()
  })
})

describe('nội dung quiz', () => {
  // Local to this broker on purpose: the BROKERS-wide rule lands in
  // `src/shell/lesson/quiz.test.ts` in the next task, once every broker has content.
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s carries a four-question quiz', (_id, lesson) => {
    const quiz = lesson.quiz ?? []
    expect(quiz.length, `${lesson.id} needs at least 4 quiz questions`).toBeGreaterThanOrEqual(4)
    for (const question of quiz) {
      expect(question.options.length, `${lesson.id}: "${question.question}"`).toBeGreaterThanOrEqual(3)
      expect(new Set(question.options).size, `${lesson.id}: "${question.question}" has duplicate options`)
        .toBe(question.options.length)
      expect(question.answerIndex).toBeGreaterThanOrEqual(0)
      expect(question.answerIndex).toBeLessThan(question.options.length)
    }
    const questions = quiz.map((q) => q.question)
    expect(new Set(questions).size, `${lesson.id} asks the same question twice`).toBe(questions.length)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has three checkpoints', (_id, lesson) => {
    expect((lesson.checkpoints ?? []).length, `${lesson.id} needs 2 mid-run beats and a wrap-up`)
      .toBeGreaterThanOrEqual(3)
  })
})
