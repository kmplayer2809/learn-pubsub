import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROGRESS_KEY,
  emptyProgress,
  lessonKey,
  readProgress,
  recordScore,
  writeProgress,
} from './progress'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('readProgress', () => {
  it('returns an empty progress when nothing is stored', () => {
    expect(readProgress()).toEqual(emptyProgress())
  })

  it('round-trips what writeProgress stored', () => {
    const stored = recordScore(emptyProgress(), { kind: 'exam', brokerId: 'redis' }, {
      correct: 16,
      total: 20,
    })
    writeProgress(stored)
    expect(readProgress()).toEqual(stored)
  })

  it('falls back to empty on unparseable JSON', () => {
    localStorage.setItem(PROGRESS_KEY, '{not json')
    expect(readProgress()).toEqual(emptyProgress())
  })

  // Losing old scores is acceptable; rendering a shape the UI does not understand is not.
  it('falls back to empty when the stored version is not 1', () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 2, lessons: {}, exams: {} }))
    expect(readProgress()).toEqual(emptyProgress())
  })

  // Safari private mode throws SecurityError on every localStorage access. An
  // uncaught throw here happens during store creation and white-screens the app.
  it('returns empty instead of throwing when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => readProgress()).not.toThrow()
    expect(readProgress()).toEqual(emptyProgress())
  })
})

describe('writeProgress', () => {
  it('swallows a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeProgress(emptyProgress())).not.toThrow()
  })
})

describe('recordScore', () => {
  const lesson = { kind: 'lesson', brokerId: 'rabbitmq', lessonId: '08-prefetch' } as const

  it('files a lesson score under brokerId/lessonId', () => {
    const next = recordScore(emptyProgress(), lesson, { correct: 3, total: 4 })
    expect(next.lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual({
      best: 3,
      total: 4,
      attempts: 1,
    })
    expect(next.exams).toEqual({})
  })

  it('files an exam score under the broker id', () => {
    const next = recordScore(emptyProgress(), { kind: 'exam', brokerId: 'kafka' }, {
      correct: 18,
      total: 20,
    })
    expect(next.exams['kafka']).toEqual({ best: 18, total: 20, attempts: 1 })
  })

  it('keeps the best score and counts every attempt', () => {
    const first = recordScore(emptyProgress(), lesson, { correct: 4, total: 4 })
    const second = recordScore(first, lesson, { correct: 1, total: 4 })
    expect(second.lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual({
      best: 4,
      total: 4,
      attempts: 2,
    })
  })

  // A lesson that grows from 4 to 6 questions makes the old best incomparable — "5/6"
  // built from a 4-question run would be a score the learner never got.
  it('restarts best when the question count changed', () => {
    const first = recordScore(emptyProgress(), lesson, { correct: 4, total: 4 })
    const second = recordScore(first, lesson, { correct: 2, total: 6 })
    expect(second.lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual({
      best: 2,
      total: 6,
      attempts: 2,
    })
  })

  it('does not mutate the progress it was given', () => {
    const before = emptyProgress()
    recordScore(before, lesson, { correct: 3, total: 4 })
    expect(before.lessons).toEqual({})
  })
})
