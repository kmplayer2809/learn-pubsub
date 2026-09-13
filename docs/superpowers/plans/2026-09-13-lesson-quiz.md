# Lesson Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every lesson in all three brokers a graded end-of-lesson quiz, give every broker a 20-question exam, let checkpoints be retried with a running score, and persist best scores in `localStorage`.

**Architecture:** A new `quiz?: QuizQuestion[]` field on `Lesson` holds untimed questions next to the lesson that teaches them, separate from the timeline-bound `checkpoints`. Three pure modules under `src/shell/quiz/` do grading, deterministic shuffling (on the existing mulberry32 rng) and `localStorage` persistence; `store.ts` holds the progress state so the sidebar re-renders when a score lands. Three UI surfaces consume them: the existing `CheckpointSection`, a new `LessonQuizDialog` opened from the Inspector, and a new `ExamDialog` opened from `LessonSidebar`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), React 19, Zustand, Vitest + @testing-library/react (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-13-lesson-quiz-design.md`

## Global Constraints

- **Vietnamese copy.** Every reader-facing string added — quiz `question`, `explanation`, options, checkpoint text, button labels — must be Vietnamese. `question` and `explanation` must contain a Vietnamese diacritic; `question`, `explanation` and every option must not contain `the|and|with|that|which|from|into|because|however` outside backticks. Broker terms (exchange, queue, routing key, ack/nack, prefetch, DLX, TTL, offset, partition, ISR, `SCAN`, `maxmemory`, eviction…) are never translated. Enforced by `src/shell/lesson/language.test.ts`.
- **Determinism.** Nothing in this plan may add `Math.random`, `Date.now`, `setTimeout` or DOM access under `src/shell/kernel/**` or any `src/brokers/<id>/engine/**`. `src/shell/quiz/**` and `src/shell/ui/**` are outside the purity guard: `Date.now()` for a shuffle seed is allowed there and nowhere else. Shuffling goes through `src/shell/kernel/rng.ts` (`createRng`, `nextInt`), never `Math.random`.
- **Typecheck.** Always `npm run typecheck`. Never `npx tsc --noEmit` — the root `tsconfig.json` is project-references only with `"files": []`, so a bare run compiles zero files and exits 0 on broken code.
- **Imports.** `import type` for type-only imports (`verbatimModuleSyntax`). Indexing an array or record yields `T | undefined` (`noUncheckedIndexedAccess`) — guard or `!`, matching what surrounding files do.
- **Tests.** `npm test` runs the whole suite (~7s). Single file: `npx vitest run <path>`. Single test: `npx vitest run -t '<name>'`.
- **The suite must be green at every commit.** This is why the `BROKERS`-wide rule tests come last (Task 14) and each content task carries a local assertion instead.
- **No snapshot churn.** `src/brokers/rabbitmq/lessons/__snapshots__/lessons.test.ts.snap` stores journals only (`runLesson` maps `journal` entries). Quiz and checkpoint content never reach the journal, so no snapshot in this plan needs updating. If one does change, something else broke — stop and investigate rather than pressing `-u`.

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/shell/quiz/grade.ts` | Score a set of answers. No React, no storage. |
| `src/shell/quiz/grade.test.ts` | Grading behaviour incl. unanswered questions. |
| `src/shell/quiz/shuffle.ts` | Seeded Fisher-Yates on `kernel/rng`, plus `sample`. |
| `src/shell/quiz/shuffle.test.ts` | Same seed ⇒ same order; nothing lost or duplicated. |
| `src/shell/quiz/progress.ts` | `localStorage` read/write + pure `recordScore`. |
| `src/shell/quiz/progress.test.ts` | Throwing storage, bad JSON, wrong version, best/attempts. |
| `src/shell/quiz/exam.ts` | Build an exam from every lesson's quiz, carrying the source lesson. |
| `src/shell/quiz/exam.test.ts` | Question count, source tagging, seed stability. |
| `src/shell/ui/Quiz/LessonQuizDialog.tsx` | End-of-lesson graded dialog. |
| `src/shell/ui/Quiz/LessonQuizDialog.test.tsx` | Submit gating, grading display, retry. |
| `src/shell/ui/Quiz/ExamDialog.tsx` | Per-broker exam dialog. |
| `src/shell/ui/Quiz/ExamDialog.test.tsx` | 20 questions, wrong-answer sources, jump to lesson. |
| `src/shell/lesson/quiz.test.ts` | (Task 14) `BROKERS`-wide quiz rule. |

**Modify:**

| File | Change |
|---|---|
| `src/shell/lesson/types.ts` | Add `QuizQuestion`, add `quiz?` to `Lesson`. |
| `src/shell/store.ts` | `progress` state + `recordLessonQuiz` / `recordExam`. |
| `src/shell/store.test.ts` | Cover the two new actions. |
| `src/shell/ui/Inspector/CheckpointCard.tsx` | Retry button, score in the section header. |
| `src/shell/ui/Inspector/CheckpointCard.test.tsx` | Retry + score assertions. |
| `src/shell/ui/Inspector/Inspector.tsx` | End-of-lesson quiz prompt + dialog. |
| `src/shell/ui/LessonSidebar/LessonSidebar.tsx` | Exam button + best-score badges. |
| `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx` | Button + badge assertions. |
| `src/brokers/{rabbitmq,redis,kafka}/lessons/*.ts` | 4 quiz questions + a 3rd checkpoint per lesson. |
| `src/brokers/{rabbitmq,redis,kafka}/lessons/lessons.test.ts` | Local quiz rule (added in the content task, removed in Task 14). |
| `src/shell/lesson/checkpoints.test.ts` | (Task 14) minimum 2 → 3. |
| `src/shell/lesson/language.test.ts` | (Task 14) cover quiz copy. |

---

### Task 1: `QuizQuestion` type and grading

**Files:**
- Modify: `src/shell/lesson/types.ts`
- Create: `src/shell/quiz/grade.ts`
- Test: `src/shell/quiz/grade.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `QuizQuestion { question: string; options: string[]; answerIndex: number; explanation: string }` exported from `src/shell/lesson/types.ts`; `Lesson.quiz?: QuizQuestion[]`; `gradeQuiz(questions: QuizQuestion[], answers: (number | undefined)[]): QuizResult` and `QuizResult { correct: number; total: number; wrongIndexes: number[] }` from `src/shell/quiz/grade.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/quiz/grade.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/quiz/grade.test.ts`
Expected: FAIL — `Failed to resolve import "./grade"`.

- [ ] **Step 3: Write the type and the implementation**

In `src/shell/lesson/types.ts`, add below the `Checkpoint` interface:

```ts
/**
 * An untimed review question. Deliberately has no `at`: unlike `Checkpoint`, which is
 * anchored to a moment in the run and may ask about what is on screen right then, a
 * quiz question also appears in the per-broker exam where no simulation is playing, so
 * it has to read correctly with no run behind it.
 */
export interface QuizQuestion {
  question: string
  options: string[]
  answerIndex: number
  explanation: string
}
```

and add the field to `Lesson`, right after `checkpoints`:

```ts
  checkpoints?: Checkpoint[]
  /** Optional in the type so a half-written lesson still compiles; `quiz.test.ts` is what
   *  requires every registered lesson to carry a full set. Same arrangement as
   *  `checkpoints?` and `checkpoints.test.ts`. */
  quiz?: QuizQuestion[]
```

Create `src/shell/quiz/grade.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/quiz/grade.test.ts && npm run typecheck`
Expected: 4 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/lesson/types.ts src/shell/quiz/grade.ts src/shell/quiz/grade.test.ts
git commit -m "feat(quiz): add the QuizQuestion type and pure grading"
```

---

### Task 2: Seeded shuffle

**Files:**
- Create: `src/shell/quiz/shuffle.ts`
- Test: `src/shell/quiz/shuffle.test.ts`

**Interfaces:**
- Consumes: `createRng`, `nextInt` from `src/shell/kernel/rng.ts`.
- Produces: `shuffle<T>(items: readonly T[], seed: number): T[]` and `sample<T>(items: readonly T[], count: number, seed: number): T[]`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/quiz/shuffle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sample, shuffle } from './shuffle'

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('shuffle', () => {
  // The point of seeding through the kernel rng rather than Math.random: the order is
  // reproducible, so a failing quiz screenshot can be reproduced from its seed.
  it('produces the same order for the same seed', () => {
    expect(shuffle(items, 42)).toEqual(shuffle(items, 42))
  })

  it('produces a different order for a different seed', () => {
    expect(shuffle(items, 42)).not.toEqual(shuffle(items, 43))
  })

  it('keeps every element exactly once', () => {
    const out = shuffle(items, 7)
    expect(out).toHaveLength(items.length)
    expect([...out].sort()).toEqual([...items].sort())
  })

  it('does not mutate the input', () => {
    const input = [...items]
    shuffle(input, 7)
    expect(input).toEqual(items)
  })

  it('handles empty and single-element inputs', () => {
    expect(shuffle([], 1)).toEqual([])
    expect(shuffle(['only'], 1)).toEqual(['only'])
  })
})

describe('sample', () => {
  it('takes the requested number of elements', () => {
    expect(sample(items, 3, 42)).toHaveLength(3)
  })

  it('takes a prefix of the shuffle for the same seed', () => {
    expect(sample(items, 3, 42)).toEqual(shuffle(items, 42).slice(0, 3))
  })

  // The exam asks for 20 questions; a broker whose bank is smaller must still produce an
  // exam rather than a padded or empty one.
  it('returns everything when count exceeds the pool', () => {
    expect(sample(items, 99, 42)).toHaveLength(items.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/quiz/shuffle.test.ts`
Expected: FAIL — `Failed to resolve import "./shuffle"`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/quiz/shuffle.ts`:

```ts
import { createRng, nextInt } from '../kernel/rng'

/**
 * Fisher-Yates driven by the kernel's mulberry32 rather than `Math.random`. The quiz UI
 * is outside the purity guard, but reusing the one rng in the repo means a shuffle is
 * reproducible from its seed and the tests can assert an exact order.
 */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let rng = createRng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(rng, i + 1)
    rng = next
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/** `count` elements drawn without replacement. Returns the whole pool if it is smaller. */
export function sample<T>(items: readonly T[], count: number, seed: number): T[] {
  return shuffle(items, seed).slice(0, count)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/quiz/shuffle.test.ts && npm run typecheck`
Expected: 8 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/quiz/shuffle.ts src/shell/quiz/shuffle.test.ts
git commit -m "feat(quiz): seeded shuffle and sample on the kernel rng"
```

---

### Task 3: Progress persistence

**Files:**
- Create: `src/shell/quiz/progress.ts`
- Test: `src/shell/quiz/progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ScoreRecord { best: number; total: number; attempts: number }`, `Progress { version: 1; lessons: Record<string, ScoreRecord>; exams: Record<string, ScoreRecord> }`, `ScoreScope`, `PROGRESS_KEY`, `emptyProgress()`, `readProgress(): Progress`, `writeProgress(p: Progress): void`, `recordScore(progress: Progress, scope: ScoreScope, result: { correct: number; total: number }): Progress`, `lessonKey(brokerId: string, lessonId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/quiz/progress.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/quiz/progress.test.ts`
Expected: FAIL — `Failed to resolve import "./progress"`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/quiz/progress.ts`:

```ts
/**
 * Quiz scores that survive a reload. Kept out of the store and out of React for the same
 * reason as `ui/theme.ts`: the storage access has to be testable without mounting a
 * component, and every touch of `localStorage` has to be wrapped.
 */
export interface ScoreRecord {
  best: number
  /** Stored alongside `best` because a lesson can gain questions later — "3" alone is
   *  unreadable, and a stale best against a new total would be a score nobody scored. */
  total: number
  attempts: number
}

export interface Progress {
  version: 1
  /** Key `${brokerId}/${lessonId}` — see `lessonKey`. */
  lessons: Record<string, ScoreRecord>
  /** Key `brokerId`. */
  exams: Record<string, ScoreRecord>
}

export type ScoreScope =
  | { kind: 'lesson'; brokerId: string; lessonId: string }
  | { kind: 'exam'; brokerId: string }

export const PROGRESS_KEY = 'broker-visualizer:progress:v1'

export function emptyProgress(): Progress {
  return { version: 1, lessons: {}, exams: {} }
}

export function lessonKey(brokerId: string, lessonId: string): string {
  return `${brokerId}/${lessonId}`
}

/**
 * `localStorage` throws `SecurityError` in Safari private mode, so every access in this
 * file is wrapped — an uncaught throw here runs during store creation and blanks the page.
 * Unreadable, unparseable or wrong-version data all resolve to "nothing learned yet":
 * losing old scores is survivable, crashing is not.
 */
export function readProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return emptyProgress()
    const parsed = JSON.parse(raw) as Partial<Progress> | null
    if (!parsed || parsed.version !== 1) return emptyProgress()
    return { version: 1, lessons: parsed.lessons ?? {}, exams: parsed.exams ?? {} }
  } catch {
    return emptyProgress()
  }
}

export function writeProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    /* private mode or quota — the score does not survive the reload, the app still runs */
  }
}

/** Pure: takes the old progress, returns a new one. Storage is the caller's business. */
export function recordScore(
  progress: Progress,
  scope: ScoreScope,
  result: { correct: number; total: number },
): Progress {
  const bucket = scope.kind === 'lesson' ? progress.lessons : progress.exams
  const key = scope.kind === 'lesson' ? lessonKey(scope.brokerId, scope.lessonId) : scope.brokerId
  const previous = bucket[key]
  const comparable = previous !== undefined && previous.total === result.total
  const next: ScoreRecord = {
    best: comparable ? Math.max(previous.best, result.correct) : result.correct,
    total: result.total,
    attempts: (previous?.attempts ?? 0) + 1,
  }
  const updated = { ...bucket, [key]: next }
  return scope.kind === 'lesson'
    ? { ...progress, lessons: updated }
    : { ...progress, exams: updated }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/quiz/progress.test.ts && npm run typecheck`
Expected: 11 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/quiz/progress.ts src/shell/quiz/progress.test.ts
git commit -m "feat(quiz): persist best scores in localStorage"
```

---

### Task 4: Progress in the store

**Files:**
- Modify: `src/shell/store.ts`
- Test: `src/shell/store.test.ts`

**Interfaces:**
- Consumes: `Progress`, `readProgress`, `writeProgress`, `recordScore`, `lessonKey` from `src/shell/quiz/progress.ts`.
- Produces: on `AppState` — `progress: Progress`, `recordLessonQuiz(lessonId: string, result: { correct: number; total: number }): void`, `recordExam(result: { correct: number; total: number }): void`. Both read `brokerId` off the current state, so callers never pass it.

- [ ] **Step 1: Write the failing test**

Append to `src/shell/store.test.ts` (inside the existing top-level `describe('app store')`, after the last test):

```ts
  it('records a lesson quiz score under the active broker and persists it', () => {
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 3, total: 4 })

    const record = useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '08-prefetch')]
    expect(record).toEqual({ best: 3, total: 4, attempts: 1 })
    expect(readProgress().lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual(record)
  })

  it('keeps the best lesson score across attempts', () => {
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 4, total: 4 })
    useAppStore.getState().recordLessonQuiz('08-prefetch', { correct: 1, total: 4 })

    expect(useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '08-prefetch')]).toEqual({
      best: 4,
      total: 4,
      attempts: 2,
    })
  })

  it('records an exam score under the active broker', () => {
    useAppStore.getState().setBroker('redis')
    useAppStore.getState().recordExam({ correct: 16, total: 20 })

    expect(useAppStore.getState().progress.exams['redis']).toEqual({
      best: 16,
      total: 20,
      attempts: 1,
    })
    expect(useAppStore.getState().progress.exams['rabbitmq']).toBeUndefined()
  })
```

and extend the file's imports and `beforeEach`:

```ts
import { lessonKey, readProgress } from './quiz/progress'
```

```ts
  beforeEach(() => {
    // Progress is read out of localStorage when the store is created, so a leftover
    // entry from a previous test would seed the next one's "best" score.
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/store.test.ts`
Expected: FAIL — `recordLessonQuiz is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/shell/store.ts`, add the import:

```ts
import { readProgress, recordScore, writeProgress, type Progress } from './quiz/progress'
```

add to the `AppState` interface, after `theme`:

```ts
  /** Điểm quiz tốt nhất, đọc từ `localStorage` lúc dựng store. Sống trong store chứ
   *  không phải trong dialog vì badge ở `LessonSidebar` nằm ở nhánh cây khác và phải
   *  vẽ lại ngay khi người học vừa nộp bài. */
  progress: Progress
```

and to the action list:

```ts
  recordLessonQuiz(lessonId: string, result: { correct: number; total: number }): void
  recordExam(result: { correct: number; total: number }): void
```

then in the store body, alongside `theme`:

```ts
    progress: readProgress(),
```

and the two actions, after `toggleTheme`:

```ts
    recordLessonQuiz(lessonId, result) {
      // brokerId comes from state, not from the caller: a dialog that is open while the
      // broker switches must not file its score under the broker now on screen.
      const { brokerId, progress } = get()
      const next = recordScore(progress, { kind: 'lesson', brokerId, lessonId }, result)
      writeProgress(next)
      set({ progress: next })
    },

    recordExam(result) {
      const { brokerId, progress } = get()
      const next = recordScore(progress, { kind: 'exam', brokerId }, result)
      writeProgress(next)
      set({ progress: next })
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/store.test.ts src/shell/store.importOrder.test.ts && npm run typecheck`
Expected: all passing. The import-order test must stay green — `quiz/progress.ts` imports nothing, so it cannot create a cycle.

- [ ] **Step 5: Commit**

```bash
git add src/shell/store.ts src/shell/store.test.ts
git commit -m "feat(quiz): hold quiz progress in the app store"
```

---

### Task 5: Checkpoint retry and running score

**Files:**
- Modify: `src/shell/ui/Inspector/CheckpointCard.tsx`
- Test: `src/shell/ui/Inspector/CheckpointCard.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CheckpointSection` unchanged in its props (`lessonId`, `checkpoints?`, `now`). `CheckpointCard` gains required props `index: number` and `onResult(index: number, correct: boolean | undefined): void`; it stays exported for the existing tests. New test ids: `checkpoint-retry`, `checkpoint-score`.

- [ ] **Step 1: Write the failing test**

Append to `src/shell/ui/Inspector/CheckpointCard.test.tsx`:

```ts
describe('CheckpointSection scoring and retry', () => {
  it('shows no score before anything is answered', () => {
    render(<CheckpointSection lessonId="08-prefetch" checkpoints={[prefetch]} now={6000} />)
    expect(screen.queryByTestId('checkpoint-score')).toBeNull()
  })

  it('counts a right answer against the questions revealed so far', () => {
    render(<CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={9000} />)

    fireEvent.click(screen.getAllByTestId('checkpoint-option-1')[0]!)

    expect(screen.getByTestId('checkpoint-score').textContent).toBe('Đúng 1/2')
  })

  it('offers a retry only on a wrong answer', () => {
    render(<CheckpointSection lessonId="08-prefetch" checkpoints={[prefetch]} now={6000} />)

    fireEvent.click(optionButton(0))
    expect(screen.getByTestId('checkpoint-retry')).toBeTruthy()
    expect(screen.getByTestId('checkpoint-score').textContent).toBe('Đúng 0/1')
  })

  it('has no retry after a right answer', () => {
    render(<CheckpointSection lessonId="08-prefetch" checkpoints={[prefetch]} now={6000} />)

    fireEvent.click(optionButton(1))
    expect(screen.queryByTestId('checkpoint-retry')).toBeNull()
  })

  it('re-enables the options and drops the score when retry is clicked', () => {
    render(<CheckpointSection lessonId="08-prefetch" checkpoints={[prefetch]} now={6000} />)

    fireEvent.click(optionButton(0))
    fireEvent.click(screen.getByTestId('checkpoint-retry'))

    expect(optionButton(0).disabled).toBe(false)
    expect(screen.queryByTestId('checkpoint-verdict')).toBeNull()
    expect(screen.queryByTestId('checkpoint-score')).toBeNull()

    fireEvent.click(optionButton(1))
    expect(screen.getByTestId('checkpoint-score').textContent).toBe('Đúng 1/1')
  })

  // Scrubbing back past a checkpoint's `at` unmounts its card. The answer has to leave
  // the score with it, or the section keeps counting a card that is no longer on screen.
  it('forgets the answer of a checkpoint that scrolled out of the run', () => {
    const { rerender } = render(
      <CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={9000} />,
    )
    fireEvent.click(screen.getAllByTestId('checkpoint-option-1')[0]!)
    expect(screen.getByTestId('checkpoint-score').textContent).toBe('Đúng 1/2')

    rerender(<CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={5999} />)
    expect(screen.queryByTestId('checkpoint-score')).toBeNull()

    rerender(<CheckpointSection lessonId="03-dlx" checkpoints={[prefetch, later]} now={9000} />)
    expect(screen.queryByTestId('checkpoint-score')).toBeNull()
    expect(screen.getAllByTestId('checkpoint-option-1')[0]!).toHaveProperty('disabled', false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/ui/Inspector/CheckpointCard.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="checkpoint-score"]`.

- [ ] **Step 3: Write the implementation**

Rewrite `src/shell/ui/Inspector/CheckpointCard.tsx` as follows. The existing doc comments stay; the ones below extend them.

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Checkpoint } from '../../lesson/types'
import { Markdown, MarkdownInline } from './Markdown'

/**
 * One checkpoint quiz. The chosen answer is local state with no reset logic of its own —
 * see `CheckpointSection`, which keys each card so React discards the state instead.
 *
 * A wrong answer can be retried: the checkpoint is a comprehension beat, so the useful
 * move after getting it wrong is reading the explanation and trying again. A right
 * answer gets no retry button — there is nothing left to learn from re-picking it.
 *
 * The card owns whether it has been answered; the section owns the score. The card
 * reports each change through `onResult` and withdraws its result on unmount, so
 * scrubbing backward past `at` takes the answer out of the tally along with the card.
 */
export function CheckpointCard({
  checkpoint,
  index,
  onResult,
}: {
  checkpoint: Checkpoint
  /** The checkpoint's index in the lesson's own array — the key the section scores by. */
  index: number
  onResult(index: number, correct: boolean | undefined): void
}) {
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const answered = chosen !== undefined
  const isCorrect = chosen === checkpoint.answerIndex

  // Withdraw on unmount only. `onResult` is a stable useCallback in the section and
  // `index` never changes for a given card, so this cleanup runs exactly once, when the
  // card leaves the screen — not on every render.
  useEffect(() => () => onResult(index, undefined), [index, onResult])

  const choose = (i: number) => {
    setChosen(i)
    onResult(index, i === checkpoint.answerIndex)
  }

  const retry = () => {
    setChosen(undefined)
    onResult(index, undefined)
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-raised p-3 shadow-sm" data-testid="checkpoint-card">
      <p className="mb-2 text-narrative leading-relaxed text-content">
        <MarkdownInline text={checkpoint.question} />
      </p>

      <ul className="space-y-1.5">
        {checkpoint.options.map((option, i) => {
          const isAnswer = i === checkpoint.answerIndex
          const isChosen = i === chosen
          return (
            <li key={i}>
              <button
                type="button"
                disabled={answered}
                onClick={() => choose(i)}
                data-testid={`checkpoint-option-${i}`}
                className={`w-full rounded-md border px-2.5 py-1.5 text-left text-meta leading-relaxed transition-colors ${
                  answered
                    ? isAnswer
                      ? 'border-ok-line bg-ok-bg text-ok-fg'
                      : isChosen
                        ? 'border-danger-line bg-danger-bg text-danger-fg'
                        : 'border-edge text-content-faint'
                    : 'border-edge-strong text-content hover:border-edge-strong hover:bg-surface-hover'
                }`}
              >
                <MarkdownInline text={option} />
                {answered && isAnswer && (
                  <span className="ml-1 text-meta font-medium text-ok-fg">· Đáp án đúng</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {answered && (
        <div className={`mt-2 rounded-md border-l-2 p-2 ${isCorrect ? 'border-ok-line bg-ok-bg' : 'border-danger-line bg-danger-bg'}`}>
          <p
            data-testid="checkpoint-verdict"
            className={`mb-1 text-meta font-semibold ${isCorrect ? 'text-ok-fg' : 'text-danger-fg'}`}
          >
            {isCorrect ? 'Đúng' : 'Chưa đúng'}
          </p>
          <div data-testid="checkpoint-explanation" className="text-content">
            <Markdown text={checkpoint.explanation} />
          </div>
          {!isCorrect && (
            <button
              type="button"
              onClick={retry}
              data-testid="checkpoint-retry"
              className="mt-2 min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Thử lại
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Every checkpoint the run has reached, oldest first. A checkpoint appears once
 * `now >= at` and stays for the rest of the run.
 *
 * The `key` is the whole reset mechanism, and it has to cover two cases the brief calls
 * out. Switching lesson changes `lessonId`, so every card is a different element and React
 * throws the old answers away. Scrubbing backward past a checkpoint's `at` drops it from
 * `visible` entirely, which unmounts it — so when time moves forward again it mounts
 * fresh, unanswered. Neither path needs an effect that writes state during render.
 *
 * The index in the key is the checkpoint's index in the lesson's own array, not its
 * position in `visible`, so revealing an earlier checkpoint cannot shift a later card's
 * identity and hand it someone else's answer.
 *
 * The score is kept here rather than in the cards because it sums across them, and it is
 * keyed by the same lesson-array index for the same reason. `results` can only ever hold
 * entries for mounted cards: each card withdraws its own on unmount.
 */
export function CheckpointSection({
  lessonId,
  checkpoints = [],
  now,
}: {
  lessonId: string
  checkpoints?: Checkpoint[]
  now: number
}) {
  const [results, setResults] = useState<Record<number, boolean>>({})

  // Stable identity: the cards' unmount cleanup depends on it, and a fresh function each
  // render would make that cleanup fire on every render and wipe the score.
  const onResult = useCallback((index: number, correct: boolean | undefined) => {
    setResults((previous) => {
      if (correct === undefined) {
        if (!(index in previous)) return previous
        const next = { ...previous }
        delete next[index]
        return next
      }
      return { ...previous, [index]: correct }
    })
  }, [])

  const visible = checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => now >= checkpoint.at)
    .sort((a, b) => a.checkpoint.at - b.checkpoint.at)

  if (visible.length === 0) return null

  const answered = visible.filter(({ index }) => index in results)
  const correct = answered.filter(({ index }) => results[index]).length

  return (
    <section className="space-y-2" data-testid="checkpoints">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-section font-semibold uppercase tracking-wider text-content-faint">Câu hỏi kiểm tra</h3>
        {answered.length > 0 && (
          <span data-testid="checkpoint-score" className="text-meta font-medium text-content-muted">
            Đúng {correct}/{visible.length}
          </span>
        )}
      </div>
      {visible.map(({ checkpoint, index }) => (
        <CheckpointCard
          key={`${lessonId}:${index}`}
          checkpoint={checkpoint}
          index={index}
          onResult={onResult}
        />
      ))}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/ui/Inspector/CheckpointCard.test.tsx && npm run typecheck`
Expected: the original tests plus the six new ones all pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/Inspector/CheckpointCard.tsx src/shell/ui/Inspector/CheckpointCard.test.tsx
git commit -m "feat(quiz): let checkpoints be retried and show a running score"
```

---

### Task 6: The end-of-lesson quiz dialog

**Files:**
- Create: `src/shell/ui/Quiz/LessonQuizDialog.tsx`
- Test: `src/shell/ui/Quiz/LessonQuizDialog.test.tsx`

**Interfaces:**
- Consumes: `QuizQuestion` (`src/shell/lesson/types.ts`), `gradeQuiz` (`src/shell/quiz/grade.ts`), `shuffle` (`src/shell/quiz/shuffle.ts`), `Markdown`/`MarkdownInline` (`src/shell/ui/Inspector/Markdown.tsx`).
- Produces: `LessonQuizDialog({ title, questions, onSubmit, onClose })` where `onSubmit(result: { correct: number; total: number }): void`. Test ids: `lesson-quiz`, `quiz-question-<i>`, `quiz-option-<i>-<j>`, `quiz-submit`, `quiz-score`, `quiz-explanation-<i>`, `quiz-retry`, `quiz-close`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/ui/Quiz/LessonQuizDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QuizQuestion } from '../../lesson/types'
import { LessonQuizDialog } from './LessonQuizDialog'

const questions: QuizQuestion[] = [
  {
    question: 'Fanout exchange định tuyến theo gì?',
    options: ['Routing key', 'Không theo gì, gửi tới mọi queue đã bind', 'Header'],
    answerIndex: 1,
    explanation: 'Fanout bỏ qua routing key, mọi queue đã bind đều nhận bản sao.',
  },
  {
    question: '`prefetch` đếm loại message nào?',
    options: ['Message đã ack', 'Message đã đẩy đi mà chưa ack', 'Message trong DLX'],
    answerIndex: 1,
    explanation: 'Prefetch giới hạn số message chưa ack mà broker đẩy cho một consumer.',
  },
]

/** The dialog shuffles, so tests locate an option by its text, never by its position. */
function clickOption(questionIndex: number, text: string | RegExp) {
  const card = screen.getByTestId(`quiz-question-${questionIndex}`)
  const match = [...card.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.includes(text) : text.test(b.textContent ?? ''),
  )
  if (!match) throw new Error(`no option matching ${text} in question ${questionIndex}`)
  fireEvent.click(match)
}

function answerAll(correct: boolean) {
  clickOption(0, correct ? 'mọi queue đã bind' : 'Header')
  clickOption(1, correct ? 'chưa ack' : 'đã ack')
}

describe('LessonQuizDialog', () => {
  it('renders every question at once, ungraded', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    expect(screen.getAllByTestId(/^quiz-question-/)).toHaveLength(2)
    expect(screen.queryByTestId('quiz-score')).toBeNull()
    expect(screen.queryByTestId('quiz-explanation-0')).toBeNull()
  })

  it('keeps submit disabled until every question is answered', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    const submit = screen.getByTestId('quiz-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    clickOption(0, 'mọi queue đã bind')
    expect(submit.disabled).toBe(true)

    clickOption(1, 'chưa ack')
    expect(submit.disabled).toBe(false)
  })

  it('lets an answer be changed before submitting', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    clickOption(0, 'Header')
    clickOption(0, 'mọi queue đã bind')
    clickOption(1, 'chưa ack')

    fireEvent.click(screen.getByTestId('quiz-submit'))
    expect(screen.getByTestId('quiz-score').textContent).toContain('2/2')
  })

  it('reports the score and explains only the wrong answers', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    clickOption(0, 'mọi queue đã bind')
    clickOption(1, 'đã ack')
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(screen.getByTestId('quiz-score').textContent).toContain('1/2')
    expect(screen.queryByTestId('quiz-explanation-0')).toBeNull()
    expect(screen.getByTestId('quiz-explanation-1').textContent).toContain('chưa ack')
  })

  it('passes the result to onSubmit', () => {
    const onSubmit = vi.fn()
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={onSubmit} onClose={() => {}} />,
    )

    answerAll(true)
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(onSubmit).toHaveBeenCalledWith({ correct: 2, total: 2 })
  })

  it('clears every answer on retry', () => {
    render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={() => {}} />,
    )

    answerAll(false)
    fireEvent.click(screen.getByTestId('quiz-submit'))
    fireEvent.click(screen.getByTestId('quiz-retry'))

    expect(screen.queryByTestId('quiz-score')).toBeNull()
    expect((screen.getByTestId('quiz-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes on the close button and on Escape', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <LessonQuizDialog title="08 · Prefetch" questions={questions} onSubmit={() => {}} onClose={onClose} />,
    )

    fireEvent.click(screen.getByTestId('quiz-close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/ui/Quiz/LessonQuizDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./LessonQuizDialog"`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/ui/Quiz/LessonQuizDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { QuizQuestion } from '../../lesson/types'
import { gradeQuiz, type QuizResult } from '../../quiz/grade'
import { shuffle } from '../../quiz/shuffle'
import { Markdown, MarkdownInline } from '../Inspector/Markdown'

/**
 * The graded quiz at the end of a lesson. Unlike a checkpoint it grades a whole set at
 * once: every question is on screen, answers can be changed freely, and nothing is marked
 * until "Nộp bài". That is the difference between a comprehension beat and a test — the
 * learner should be able to think about question 4 and go back to change question 1.
 *
 * The overlay is built the way `ExportDialog` is: fixed backdrop, click-outside and
 * Escape both close, the inner panel stops propagation.
 */
export function LessonQuizDialog({
  title,
  questions,
  onSubmit,
  onClose,
}: {
  /** Shown in the header so the learner knows which lesson they are being tested on. */
  title: string
  questions: QuizQuestion[]
  onSubmit(result: { correct: number; total: number }): void
  onClose(): void
}) {
  // A new seed per attempt, so "Làm lại" reshuffles instead of replaying the same order
  // the learner has just memorised. `Date.now` is fine here: this is the UI layer, which
  // the determinism guard does not cover — the engine never sees this value.
  const [seed, setSeed] = useState(() => Date.now())
  const [answers, setAnswers] = useState<(number | undefined)[]>([])
  const [result, setResult] = useState<QuizResult | undefined>(undefined)

  const ordered = useMemo(() => shuffle(questions, seed), [questions, seed])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const answeredAll = ordered.every((_, i) => answers[i] !== undefined)
  const graded = result !== undefined

  const choose = (questionIndex: number, optionIndex: number) => {
    if (graded) return
    setAnswers((previous) => {
      const next = [...previous]
      next[questionIndex] = optionIndex
      return next
    })
  }

  const submit = () => {
    const scored = gradeQuiz(ordered, answers)
    setResult(scored)
    onSubmit({ correct: scored.correct, total: scored.total })
  }

  const retry = () => {
    setSeed(Date.now())
    setAnswers([])
    setResult(undefined)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="lesson-quiz"
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-ui font-semibold text-content-strong">Bài test cuối bài</h2>
            <p className="text-meta text-content-faint">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            {graded && (
              <span
                data-testid="quiz-score"
                className={`rounded-md px-2 py-1 text-meta font-semibold ${
                  result.correct === result.total ? 'bg-ok-bg text-ok-fg' : 'bg-warn-bg text-warn-fg'
                }`}
              >
                Đúng {result.correct}/{result.total}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              data-testid="quiz-close"
              className="min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đóng
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {ordered.map((question, i) => {
            const chosen = answers[i]
            const isWrong = graded && result.wrongIndexes.includes(i)
            return (
              <div
                key={`${seed}:${i}`}
                data-testid={`quiz-question-${i}`}
                className="rounded-lg border border-edge bg-surface-raised p-3"
              >
                <p className="mb-2 text-narrative leading-relaxed text-content">
                  <span className="mr-1 font-mono text-meta text-content-faint">{i + 1}.</span>
                  <MarkdownInline text={question.question} />
                </p>
                <ul className="space-y-1.5">
                  {question.options.map((option, j) => {
                    const isAnswer = j === question.answerIndex
                    const isChosen = j === chosen
                    return (
                      <li key={j}>
                        <button
                          type="button"
                          disabled={graded}
                          onClick={() => choose(i, j)}
                          data-testid={`quiz-option-${i}-${j}`}
                          className={`w-full rounded-md border px-2.5 py-1.5 text-left text-meta leading-relaxed transition-colors ${
                            graded
                              ? isAnswer
                                ? 'border-ok-line bg-ok-bg text-ok-fg'
                                : isChosen
                                  ? 'border-danger-line bg-danger-bg text-danger-fg'
                                  : 'border-edge text-content-faint'
                              : isChosen
                                ? 'border-accent bg-accent-soft text-accent'
                                : 'border-edge-strong text-content hover:bg-surface-hover'
                          }`}
                        >
                          <MarkdownInline text={option} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {/* Only the wrong answers get an explanation: re-reading why the answer the
                    learner already picked is right teaches nothing and buries the misses. */}
                {isWrong && (
                  <div
                    data-testid={`quiz-explanation-${i}`}
                    className="mt-2 rounded-md border-l-2 border-danger-line bg-danger-bg p-2 text-content"
                  >
                    <Markdown text={question.explanation} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
          {graded ? (
            <button
              type="button"
              onClick={retry}
              data-testid="quiz-retry"
              className="min-h-11 rounded-md border border-edge-strong px-3 py-1.5 text-ui font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Làm lại
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!answeredAll}
              data-testid="quiz-submit"
              className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0"
            >
              Nộp bài
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

> The primary-button classes above (`bg-accent … text-accent-fg hover:bg-accent-hover`) are copied from `src/shell/ui/Transport/Transport.tsx:44`, the repo's play button. Never invent a token name — `npm run lint` does not catch a Tailwind class that does not exist, it just renders unstyled.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/ui/Quiz/LessonQuizDialog.test.tsx && npm run typecheck`
Expected: 7 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/Quiz/LessonQuizDialog.tsx src/shell/ui/Quiz/LessonQuizDialog.test.tsx
git commit -m "feat(quiz): add the graded end-of-lesson dialog"
```

---

### Task 7: Open the quiz from the Inspector

**Files:**
- Modify: `src/shell/ui/Inspector/Inspector.tsx`
- Test: `src/shell/ui/Inspector/Inspector.test.tsx` (create — the file does not exist yet)

**Interfaces:**
- Consumes: `LessonQuizDialog` (Task 6), `recordLessonQuiz` from the store (Task 4).
- Produces: test ids `lesson-quiz-prompt`, `lesson-quiz-start`. No prop changes to `Inspector`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/ui/Inspector/Inspector.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getBroker } from '../../../brokers/registry'
import type { Lesson } from '../../lesson/types'
import { useAppStore } from '../../store'
import { lessonKey } from '../../quiz/progress'
import { Inspector } from './Inspector'

const broker = getBroker('rabbitmq')

/** A minimal lesson: the Inspector only reads narrative, checkpoints, quiz and ids. */
const lesson = {
  id: '99-quiz-fixture',
  group: 'basics',
  title: 'Fixture',
  summary: 'Bài dùng cho test.',
  topology: broker.emptyTopology,
  script: [],
  narrative: [{ at: 0, title: 'Mở đầu', body: 'Nội dung mở đầu.' }],
  checkpoints: [],
  quiz: [
    {
      question: 'Fanout exchange định tuyến theo gì?',
      options: ['Routing key', 'Không theo gì, gửi tới mọi queue đã bind', 'Header'],
      answerIndex: 1,
      explanation: 'Fanout bỏ qua routing key.',
    },
  ],
  seed: 1,
  durationMs: 10_000,
} as unknown as Lesson<unknown, unknown>

function renderAt(now: number) {
  const state = { now, seq: 0, rng: { s: 1 }, journal: [] } as never
  return render(<Inspector broker={broker} lesson={lesson} state={state} issues={[]} />)
}

describe('Inspector end-of-lesson quiz', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('hides the prompt while the lesson is still running', () => {
    renderAt(9_999)
    expect(screen.queryByTestId('lesson-quiz-prompt')).toBeNull()
  })

  it('offers the quiz once the run reaches durationMs', () => {
    renderAt(10_000)
    expect(screen.getByTestId('lesson-quiz-prompt').textContent).toContain('1 câu')
  })

  it('opens the dialog and files the score under the lesson', () => {
    renderAt(10_000)
    fireEvent.click(screen.getByTestId('lesson-quiz-start'))

    const correct = [...screen.getByTestId('quiz-question-0').querySelectorAll('button')].find((b) =>
      b.textContent?.includes('mọi queue đã bind'),
    )!
    fireEvent.click(correct)
    fireEvent.click(screen.getByTestId('quiz-submit'))

    expect(useAppStore.getState().progress.lessons[lessonKey('rabbitmq', '99-quiz-fixture')]).toEqual({
      best: 1,
      total: 1,
      attempts: 1,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/ui/Inspector/Inspector.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="lesson-quiz-prompt"]`.

- [ ] **Step 3: Write the implementation**

In `src/shell/ui/Inspector/Inspector.tsx`:

add the imports

```tsx
import { useAppStore } from '../../store'
import { LessonQuizDialog } from '../Quiz/LessonQuizDialog'
```

add state and the store action inside `Inspector`, next to `exportOpen`:

```tsx
  const [quizOpen, setQuizOpen] = useState(false)
  const recordLessonQuiz = useAppStore((s) => s.recordLessonQuiz)
  const quiz = lesson.quiz ?? []
  // The transport stops at durationMs, so this is the one moment we can be sure the
  // lesson has played out — the same reason the wrap-up checkpoint sits exactly there.
  const lessonFinished = state.now >= lesson.durationMs
```

and render the prompt right below `<CheckpointSection ... />`:

```tsx
        {quiz.length > 0 && lessonFinished && (
          <section
            data-testid="lesson-quiz-prompt"
            className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-raised p-3"
          >
            <div>
              <p className="text-ui font-medium text-content-strong">Bài test cuối bài</p>
              <p className="text-meta text-content-faint">{quiz.length} câu, có chấm điểm</p>
            </div>
            <button
              type="button"
              onClick={() => setQuizOpen(true)}
              data-testid="lesson-quiz-start"
              className="min-h-11 shrink-0 rounded-md border border-edge-strong px-3 py-1.5 text-ui font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Bắt đầu
            </button>
          </section>
        )}

        {quizOpen && quiz.length > 0 && (
          <LessonQuizDialog
            // Keyed by lesson: switching lesson while the dialog is open must not carry
            // the previous lesson's answers into the new one's questions.
            key={lesson.id}
            title={lesson.title}
            questions={quiz}
            onSubmit={(result) => recordLessonQuiz(lesson.id, result)}
            onClose={() => setQuizOpen(false)}
          />
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/ui/Inspector && npm run typecheck`
Expected: 3 passing tests in the new file, `CheckpointCard.test.tsx` still green.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/Inspector/Inspector.tsx src/shell/ui/Inspector/Inspector.test.tsx
git commit -m "feat(quiz): offer the end-of-lesson quiz when the run finishes"
```

---

### Task 8: Building an exam

**Files:**
- Create: `src/shell/quiz/exam.ts`
- Test: `src/shell/quiz/exam.test.ts`

**Interfaces:**
- Consumes: `QuizQuestion` (`src/shell/lesson/types.ts`), `sample` (`src/shell/quiz/shuffle.ts`).
- Produces: `EXAM_QUESTION_COUNT = 20`, `ExamQuestion extends QuizQuestion { lessonId: string; lessonTitle: string }`, `buildExam(lessons: ExamSource[], seed: number, count?: number): ExamQuestion[]`, `ExamSource { id: string; title: string; quiz?: QuizQuestion[] }`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/quiz/exam.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/quiz/exam.test.ts`
Expected: FAIL — `Failed to resolve import "./exam"`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/quiz/exam.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/quiz/exam.test.ts && npm run typecheck`
Expected: 8 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/quiz/exam.ts src/shell/quiz/exam.test.ts
git commit -m "feat(quiz): build a per-broker exam from every lesson's quiz"
```

---

### Task 9: The exam dialog

**Files:**
- Create: `src/shell/ui/Quiz/ExamDialog.tsx`
- Test: `src/shell/ui/Quiz/ExamDialog.test.tsx`

**Interfaces:**
- Consumes: `buildExam`, `EXAM_QUESTION_COUNT`, `ExamQuestion` (Task 8), `gradeQuiz` (Task 1), `Markdown`/`MarkdownInline`.
- Produces: `ExamDialog({ brokerLabel, lessons, onSubmit, onJumpToLesson, onClose })` — `lessons: ExamSource[]`, `onSubmit(result: { correct: number; total: number }): void`, `onJumpToLesson(lessonId: string): void`. Test ids: `exam`, `exam-question-<i>`, `exam-submit`, `exam-score`, `exam-review`, `exam-review-<i>`, `exam-jump-<lessonId>`, `exam-retry`, `exam-close`.

- [ ] **Step 1: Write the failing test**

Create `src/shell/ui/Quiz/ExamDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExamSource } from '../../quiz/exam'
import { ExamDialog } from './ExamDialog'

function source(id: string, title: string, n: number): ExamSource {
  return {
    id,
    title,
    quiz: Array.from({ length: n }, (_, i) => ({
      question: `Câu ${i} của ${id}?`,
      options: ['Một', 'Hai', 'Ba'],
      answerIndex: 0,
      explanation: `Giải thích câu ${i} của ${id}.`,
    })),
  }
}

const lessons = [source('01-a', 'Bài A', 12), source('02-b', 'Bài B', 12)]

/** Answer every question; `rightAnswer` picks option 0, the correct one in the fixture. */
function answerAll(rightAnswer: boolean) {
  for (const card of screen.getAllByTestId(/^exam-question-/)) {
    const buttons = [...card.querySelectorAll('button')]
    fireEvent.click(buttons[rightAnswer ? 0 : 1]!)
  }
}

describe('ExamDialog', () => {
  it('asks twenty questions', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getAllByTestId(/^exam-question-/)).toHaveLength(20)
  })

  it('keeps submit disabled until every question is answered', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(true)
    answerAll(true)
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('scores a perfect run and shows no review list', () => {
    const onSubmit = vi.fn()
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={onSubmit}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(true)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('20/20')
    expect(onSubmit).toHaveBeenCalledWith({ correct: 20, total: 20 })
    expect(screen.queryByTestId('exam-review')).toBeNull()
  })

  it('lists every miss with the lesson it came from', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))

    expect(screen.getByTestId('exam-score').textContent).toContain('0/20')
    expect(screen.getAllByTestId(/^exam-review-/)).toHaveLength(20)
    expect(screen.getByTestId('exam-review').textContent).toContain('Bài A')
  })

  it('jumps to a missed question’s lesson and closes', () => {
    const onJumpToLesson = vi.fn()
    const onClose = vi.fn()
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={onJumpToLesson}
        onClose={onClose}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getAllByTestId(/^exam-jump-/)[0]!)

    expect(onJumpToLesson).toHaveBeenCalledTimes(1)
    expect(['01-a', '02-b']).toContain(onJumpToLesson.mock.calls[0]![0])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('draws a fresh exam on retry', () => {
    render(
      <ExamDialog
        brokerLabel="RabbitMQ"
        lessons={lessons}
        onSubmit={() => {}}
        onJumpToLesson={() => {}}
        onClose={() => {}}
      />,
    )
    answerAll(false)
    fireEvent.click(screen.getByTestId('exam-submit'))
    fireEvent.click(screen.getByTestId('exam-retry'))

    expect(screen.queryByTestId('exam-score')).toBeNull()
    expect((screen.getByTestId('exam-submit') as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/ui/Quiz/ExamDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./ExamDialog"`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/ui/Quiz/ExamDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { buildExam, type ExamSource } from '../../quiz/exam'
import { gradeQuiz, type QuizResult } from '../../quiz/grade'
import { Markdown, MarkdownInline } from '../Inspector/Markdown'

/**
 * The per-broker final exam: twenty questions drawn from every lesson's quiz, with no
 * lesson running behind it. That is why `QuizQuestion` carries no `at` — these questions
 * are read cold.
 *
 * The result screen is the point of the exam: each miss links back to the lesson that
 * teaches it, so the score turns into a reading list instead of a number.
 */
export function ExamDialog({
  brokerLabel,
  lessons,
  onSubmit,
  onJumpToLesson,
  onClose,
}: {
  brokerLabel: string
  lessons: readonly ExamSource[]
  onSubmit(result: { correct: number; total: number }): void
  onJumpToLesson(lessonId: string): void
  onClose(): void
}) {
  const [seed, setSeed] = useState(() => Date.now())
  const [answers, setAnswers] = useState<(number | undefined)[]>([])
  const [result, setResult] = useState<QuizResult | undefined>(undefined)

  const questions = useMemo(() => buildExam(lessons, seed), [lessons, seed])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const graded = result !== undefined
  const answeredAll = questions.length > 0 && questions.every((_, i) => answers[i] !== undefined)

  const choose = (questionIndex: number, optionIndex: number) => {
    if (graded) return
    setAnswers((previous) => {
      const next = [...previous]
      next[questionIndex] = optionIndex
      return next
    })
  }

  const submit = () => {
    const scored = gradeQuiz(questions, answers)
    setResult(scored)
    onSubmit({ correct: scored.correct, total: scored.total })
  }

  const retry = () => {
    setSeed(Date.now())
    setAnswers([])
    setResult(undefined)
  }

  const jump = (lessonId: string) => {
    onJumpToLesson(lessonId)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="exam"
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-ui font-semibold text-content-strong">Thi tổng kết · {brokerLabel}</h2>
            <p className="text-meta text-content-faint">{questions.length} câu rút từ mọi bài học</p>
          </div>
          <div className="flex items-center gap-2">
            {graded && (
              <span
                data-testid="exam-score"
                className={`rounded-md px-2 py-1 text-meta font-semibold ${
                  result.correct === result.total ? 'bg-ok-bg text-ok-fg' : 'bg-warn-bg text-warn-fg'
                }`}
              >
                Đúng {result.correct}/{result.total}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              data-testid="exam-close"
              className="min-h-11 rounded-md border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đóng
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {graded && result.wrongIndexes.length > 0 && (
            <section
              data-testid="exam-review"
              className="space-y-1.5 rounded-lg border border-warn-line bg-warn-bg p-3"
            >
              <h3 className="text-section font-semibold uppercase tracking-wider text-warn-fg">Cần xem lại</h3>
              {result.wrongIndexes.map((i) => {
                const question = questions[i]!
                return (
                  <div key={i} data-testid={`exam-review-${i}`} className="text-meta text-content">
                    <button
                      type="button"
                      onClick={() => jump(question.lessonId)}
                      data-testid={`exam-jump-${question.lessonId}`}
                      className="text-left font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {question.lessonTitle}
                    </button>
                    <span className="text-content-faint"> · câu {i + 1}</span>
                  </div>
                )
              })}
            </section>
          )}

          {questions.map((question, i) => {
            const chosen = answers[i]
            const isWrong = graded && result.wrongIndexes.includes(i)
            return (
              <div
                key={`${seed}:${i}`}
                data-testid={`exam-question-${i}`}
                className="rounded-lg border border-edge bg-surface-raised p-3"
              >
                <p className="mb-1 text-meta text-content-faint">
                  {i + 1}. {question.lessonTitle}
                </p>
                <p className="mb-2 text-narrative leading-relaxed text-content">
                  <MarkdownInline text={question.question} />
                </p>
                <ul className="space-y-1.5">
                  {question.options.map((option, j) => {
                    const isAnswer = j === question.answerIndex
                    const isChosen = j === chosen
                    return (
                      <li key={j}>
                        <button
                          type="button"
                          disabled={graded}
                          onClick={() => choose(i, j)}
                          className={`w-full rounded-md border px-2.5 py-1.5 text-left text-meta leading-relaxed transition-colors ${
                            graded
                              ? isAnswer
                                ? 'border-ok-line bg-ok-bg text-ok-fg'
                                : isChosen
                                  ? 'border-danger-line bg-danger-bg text-danger-fg'
                                  : 'border-edge text-content-faint'
                              : isChosen
                                ? 'border-accent bg-accent-soft text-accent'
                                : 'border-edge-strong text-content hover:bg-surface-hover'
                          }`}
                        >
                          <MarkdownInline text={option} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {isWrong && (
                  <div className="mt-2 rounded-md border-l-2 border-danger-line bg-danger-bg p-2 text-content">
                    <Markdown text={question.explanation} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
          {graded ? (
            <button
              type="button"
              onClick={retry}
              data-testid="exam-retry"
              className="min-h-11 rounded-md border border-edge-strong px-3 py-1.5 text-ui font-medium text-content hover:bg-surface-hover md:min-h-0"
            >
              Đề khác
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!answeredAll}
              data-testid="exam-submit"
              className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0"
            >
              Nộp bài
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/ui/Quiz/ExamDialog.test.tsx && npm run typecheck`
Expected: 6 passing tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/Quiz/ExamDialog.tsx src/shell/ui/Quiz/ExamDialog.test.tsx
git commit -m "feat(quiz): add the per-broker exam dialog"
```

---

### Task 10: Sidebar exam button and score badges

**Files:**
- Modify: `src/shell/ui/LessonSidebar/LessonSidebar.tsx`
- Test: `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`

**Interfaces:**
- Consumes: `ExamDialog` (Task 9), `lessonKey` (Task 3), `progress` / `recordExam` / `setLesson` from the store.
- Produces: test ids `open-exam`, `lesson-score-<lessonId>`.

- [ ] **Step 1: Write the failing test**

Append to `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`. The file already imports `render`, `screen`, `useAppStore` and `LessonSidebar`, and already has a top-level `beforeEach` resetting the store — add `fireEvent` to the `@testing-library/react` import; the `beforeEach` below additionally clears `localStorage`, which the progress state is read from:

```tsx
describe('LessonSidebar quiz progress', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('shows no badge for a lesson never quizzed', () => {
    render(<LessonSidebar />)
    expect(screen.queryByTestId('lesson-score-01-hello-world')).toBeNull()
  })

  it('shows the best score for a lesson already quizzed', () => {
    useAppStore.getState().recordLessonQuiz('01-hello-world', { correct: 3, total: 4 })
    render(<LessonSidebar />)
    expect(screen.getByTestId('lesson-score-01-hello-world').textContent).toBe('3/4')
  })

  it('marks a perfect score with a tick instead of a number', () => {
    useAppStore.getState().recordLessonQuiz('01-hello-world', { correct: 4, total: 4 })
    render(<LessonSidebar />)
    expect(screen.getByTestId('lesson-score-01-hello-world').textContent).toBe('✓')
  })

  // Sandbox is RabbitMQ-only; the exam is not — every broker has a quiz bank.
  it('offers the exam and opens it', () => {
    render(<LessonSidebar />)
    fireEvent.click(screen.getByTestId('open-exam'))
    expect(screen.getByTestId('exam')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="open-exam"]`.

- [ ] **Step 3: Write the implementation**

In `src/shell/ui/LessonSidebar/LessonSidebar.tsx`:

add imports

```tsx
import { useState } from 'react'
import { lessonKey } from '../../quiz/progress'
import { ExamDialog } from '../Quiz/ExamDialog'
```

add state and selectors next to the existing ones:

```tsx
  const brokerId = useAppStore((s) => s.brokerId)
  const progress = useAppStore((s) => s.progress)
  const recordExam = useAppStore((s) => s.recordExam)
  const [examOpen, setExamOpen] = useState(false)
```

(reuse the existing `broker` binding — change it to `const broker = getBroker(brokerId)` so the id is available for `lessonKey`.)

inside the lesson `map`, before the `return`:

```tsx
              const score = progress.lessons[lessonKey(brokerId, lesson.id)]
```

and inside the lesson button, after the title span:

```tsx
                  {score && (
                    <span
                      data-testid={`lesson-score-${lesson.id}`}
                      className={`shrink-0 font-mono text-meta ${
                        score.best === score.total ? 'text-ok-fg' : 'text-content-faint'
                      }`}
                    >
                      {score.best === score.total ? '✓' : `${score.best}/${score.total}`}
                    </span>
                  )}
```

then the exam button, directly above the existing sandbox button:

```tsx
      <button
        onClick={() => setExamOpen(true)}
        data-testid="open-exam"
        className="flex min-h-11 shrink-0 items-center gap-2 border-t border-edge px-3 py-2 text-left text-ui font-medium text-content-muted hover:bg-surface-hover hover:text-content md:min-h-0"
      >
        Thi tổng kết
      </button>

      {examOpen && (
        <ExamDialog
          // Keyed by broker: switching broker with the dialog open must redraw the exam
          // from the new broker's bank rather than keep the old one's questions.
          key={brokerId}
          brokerLabel={broker.label}
          lessons={broker.lessons}
          onSubmit={recordExam}
          onJumpToLesson={setLesson}
          onClose={() => setExamOpen(false)}
        />
      )}
```

> `broker.label` comes from the broker module. If the module's field is named differently, use `catalogEntry(brokerId).label` from `src/brokers/catalog.ts` — check before writing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shell/ui/LessonSidebar && npm run typecheck && npm test`
Expected: new tests pass, whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/LessonSidebar/LessonSidebar.tsx src/shell/ui/LessonSidebar/LessonSidebar.test.tsx
git commit -m "feat(quiz): add the exam entry point and score badges to the sidebar"
```

---

### Task 11: RabbitMQ content — 17 lessons

**Files:**
- Modify: all 17 of `src/brokers/rabbitmq/lessons/01-hello-world.ts` … `17-quorum.ts`
- Modify: `src/brokers/rabbitmq/lessons/lessons.test.ts`

**Interfaces:**
- Consumes: `QuizQuestion` via `src/brokers/rabbitmq/lessons/types.ts` (re-export it there if the file re-exports `Checkpoint`; otherwise import from `../../../shell/lesson/types`).
- Produces: `quiz` arrays of 4 and `checkpoints` arrays of 3 on every RabbitMQ lesson.

- [ ] **Step 1: Write the failing test**

Append a new top-level block at the end of `src/brokers/rabbitmq/lessons/lessons.test.ts` (a new `describe`, not an edit inside the existing `describe('every lesson')` — the three brokers' test files have different top-level shapes, and a self-contained block reads the same in all three):

```ts
describe('nội dung quiz', () => {
  // Local to this broker on purpose: the BROKERS-wide rule lands in
  // `src/shell/lesson/quiz.test.ts` once all three brokers have content. Written here
  // first so this task's 17 lessons are checked without turning the other two red.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/rabbitmq/lessons/lessons.test.ts`
Expected: FAIL — 17 × "needs at least 4 quiz questions", 17 × "needs 2 mid-run beats and a wrap-up".

- [ ] **Step 3: Write the content**

For each of the 17 lessons, add a `quiz` array of 4 questions and a second mid-run checkpoint. Work one lesson at a time, running the test file after each, and derive every question from that lesson's own `narrative` — a question about something the lesson never showed is noise.

Shape to follow, using `08-prefetch.ts` as the worked example:

```ts
  checkpoints: [
    // ...the two that already exist, plus one more mid-run beat at a timestamp no other
    // checkpoint uses. Pick a moment the narrative has just explained something.
    {
      at: 4500,
      question: 'Ngay lúc này consumer đang giữ bao nhiêu message chưa ack?',
      options: ['0', '1', '2'],
      answerIndex: 1,
      explanation: '`prefetch: 1` cho phép đúng một message chưa ack mỗi consumer.',
    },
  ],
  quiz: [
    {
      question: '`prefetch` giới hạn cái gì?',
      options: [
        'Số message chưa ack broker đẩy cho một consumer',
        'Số message mỗi queue chứa được',
        'Số consumer mỗi queue',
        'Kích thước tối đa của message',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch là cửa sổ message đã đẩy đi mà chưa được ack. Đầy cửa sổ thì broker ngừng đẩy cho consumer đó.',
    },
    {
      question: 'Consumer chậm giữ một message không ack, `prefetch: 1`, chuyện gì xảy ra?',
      options: [
        'Consumer đó không nhận thêm message nào cho tới khi ack',
        'Broker huỷ message và gửi cho consumer khác ngay',
        'Queue ngừng nhận message mới từ producer',
        'Message tự động vào DLX',
      ],
      answerIndex: 0,
      explanation:
        'Chỉ consumer đó bị chặn. Queue vẫn nhận message mới, và consumer khác vẫn được đẩy message.',
    },
    {
      question: 'Vì sao `prefetch` cao lại làm lệch tải giữa các consumer?',
      options: [
        'Một consumer ôm sẵn nhiều message dù nó đang xử lý chậm',
        'Broker ưu tiên consumer kết nối trước',
        'Message lớn luôn về cùng một consumer',
        'Routing key quyết định consumer nhận message',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch cao nghĩa là message nằm chờ trong bộ đệm của một consumer thay vì chờ trong queue, nơi consumer rảnh có thể nhận.',
    },
    {
      question: 'Với tác vụ ngắn và đều nhau, `prefetch` nên đặt thế nào?',
      options: [
        'Cao hơn 1, để bớt vòng chờ giữa broker và consumer',
        'Luôn đặt bằng 1',
        'Đặt bằng số queue',
        'Không đặt, mặc định luôn tối ưu',
      ],
      answerIndex: 0,
      explanation:
        'Prefetch 1 trả giá một vòng round-trip cho mỗi message. Tác vụ ngắn và đều thì cửa sổ lớn hơn cho thông lượng cao hơn mà lệch tải không đáng kể.',
    },
  ],
```

Content rules for every question written in this task and in Tasks 12-13:

- 4 options, exactly one right, and the three wrong ones must be *plausible* — an option nobody would pick teaches nothing and makes the question a giveaway.
- `explanation` says why the right answer is right, not just what it is.
- Vietnamese with diacritics in `question` and `explanation`; broker terms stay English inside backticks where the lesson already writes them that way.
- No `the|and|with|that|which|from|into|because|however` outside backticks, anywhere — options included.
- Don't reuse a checkpoint's question verbatim as a quiz question.
- The new checkpoint's `at` must not collide with an existing one in the same lesson and must be `< durationMs`.

- [ ] **Step 4: Run the broker's tests**

Run: `npx vitest run src/brokers/rabbitmq && npm run typecheck && npm run lint`
Expected: all green, including the untouched golden-journal snapshots — quiz content never reaches the journal, so a snapshot failure here means something else was edited by accident.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/rabbitmq/lessons
git commit -m "feat(rabbitmq): add an end-of-lesson quiz and a third checkpoint to every lesson"
```

---

### Task 12: Redis content — 17 lessons

**Files:**
- Modify: all 17 of `src/brokers/redis/lessons/01-*.ts` … `17-*.ts`
- Modify: `src/brokers/redis/lessons/lessons.test.ts`

**Interfaces:**
- Consumes: `QuizQuestion` via `src/brokers/redis/lessons/types.ts` or `../../../shell/lesson/types`.
- Produces: `quiz` arrays of 4 and `checkpoints` arrays of 3 on every Redis lesson.

- [ ] **Step 1: Write the failing test**

Append a new top-level block at the end of `src/brokers/redis/lessons/lessons.test.ts`. That file's existing top level is a `describe.each` per lesson, so this block stands on its own. The code is identical to Task 11 Step 1 — repeated in full so this task can be executed without reading that one:

```ts
describe('nội dung quiz', () => {
  // Local to this broker on purpose: the BROKERS-wide rule lands in
  // `src/shell/lesson/quiz.test.ts` once all three brokers have content.
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
```

`LESSONS` is already imported in all three `lessons.test.ts` files, so the block needs no new import beyond what is there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/redis/lessons/lessons.test.ts`
Expected: FAIL — 17 × "needs at least 4 quiz questions".

- [ ] **Step 3: Write the content**

Same shape and same content rules as Task 11 Step 3. Redis terminology stays English: `SCAN`, `maxmemory`, eviction, cache-aside, TTL, keyspace, pipeline, `WATCH`/`MULTI`, pub/sub, stream, consumer group. A worked example, for the cache-aside lesson:

```ts
  quiz: [
    {
      question: 'Trong cache-aside, ai chịu trách nhiệm nạp dữ liệu vào cache?',
      options: [
        'Ứng dụng, sau một lần đọc trượt cache',
        'Redis tự nạp khi key hết hạn',
        'Database đẩy sang Redis mỗi lần ghi',
        'Một tiến trình nền của Redis quét bảng',
      ],
      answerIndex: 0,
      explanation:
        'Cache-aside đặt cache ra bên cạnh: ứng dụng đọc cache, trượt thì đọc database rồi tự ghi ngược lại bằng `SET`.',
    },
    // ...ba câu nữa, bám narrative của chính bài này
  ],
```

- [ ] **Step 4: Run the broker's tests**

Run: `npx vitest run src/brokers/redis && npm run typecheck && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/redis/lessons
git commit -m "feat(redis): add an end-of-lesson quiz and a third checkpoint to every lesson"
```

---

### Task 13: Kafka content — 25 lessons

**Files:**
- Modify: all 25 of `src/brokers/kafka/lessons/01-topic-partition.ts` … `25-zero-copy.ts`
- Modify: `src/brokers/kafka/lessons/lessons.test.ts`

**Interfaces:**
- Consumes: `QuizQuestion` via `src/brokers/kafka/lessons/types.ts` or `../../../shell/lesson/types`.
- Produces: `quiz` arrays of 4 and `checkpoints` arrays of 3 on every Kafka lesson.

- [ ] **Step 1: Write the failing test**

Append a new top-level block at the end of `src/brokers/kafka/lessons/lessons.test.ts`, alongside the existing `describe('mọi lesson Kafka')` — the same two assertions, repeated in full:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brokers/kafka/lessons/lessons.test.ts`
Expected: FAIL — 25 × "needs at least 4 quiz questions".

- [ ] **Step 3: Write the content**

Same shape and rules as Task 11 Step 3, across 25 lessons. Kafka terms stay English: partition, offset, `acks`, ISR, `min.insync.replicas`, consumer group, rebalance, assignor, `max.poll.interval.ms`, retention, compaction, transaction, EOS, DLQ. A worked example, for `06-acks.ts`:

```ts
  quiz: [
    {
      question: '`acks=1` xác nhận cho producer tại thời điểm nào?',
      options: [
        'Khi leader ghi xong, chưa cần follower sao chép',
        'Khi mọi replica trong ISR đã ghi',
        'Ngay khi request rời producer',
        'Khi consumer đọc được message',
      ],
      answerIndex: 0,
      explanation:
        'Leader trả lời ngay sau khi ghi vào log của mình. Leader chết trước lúc follower kịp sao chép thì message đó mất.',
    },
    // ...ba câu nữa
  ],
```

- [ ] **Step 4: Run the broker's tests**

Run: `npx vitest run src/brokers/kafka && npm run typecheck && npm run lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/brokers/kafka/lessons
git commit -m "feat(kafka): add an end-of-lesson quiz and a third checkpoint to every lesson"
```

---

### Task 14: Lock the rules across every broker

**Files:**
- Create: `src/shell/lesson/quiz.test.ts`
- Modify: `src/shell/lesson/checkpoints.test.ts`
- Modify: `src/shell/lesson/language.test.ts`
- Modify: `src/brokers/{rabbitmq,redis,kafka}/lessons/lessons.test.ts` (remove the three local copies added in Tasks 11-13)
- Modify: `README.md`

**Interfaces:**
- Consumes: `BROKERS` from `src/brokers/registry.ts`; every lesson's `quiz` from Tasks 11-13.
- Produces: nothing importable — this task is the product rule.

- [ ] **Step 1: Write the failing test**

Create `src/shell/lesson/quiz.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it passes for the right reason**

Run: `npx vitest run src/shell/lesson/quiz.test.ts`
Expected: PASS — all 59 lessons already carry a quiz after Tasks 11-13. To prove the test bites rather than vacuously passing, temporarily delete one question from `src/brokers/redis/lessons/01-*.ts`, re-run, see it fail with "needs at least 4 quiz questions", then restore it.

- [ ] **Step 3: Raise the checkpoint minimum and cover quiz copy**

In `src/shell/lesson/checkpoints.test.ts`, change the minimum and its comment:

```ts
    const checkpoints = lesson.checkpoints ?? []
    expect(checkpoints.length, `${lesson.id} needs two mid-run beats and a wrap-up checkpoint`)
      .toBeGreaterThanOrEqual(3)
```

and update the block comment above `describe.each` from "Two checkpoints minimum: one comprehension beat…" to "Three checkpoints minimum: two comprehension beats while the run is still playing, and one wrap-up at `durationMs`."

In `src/shell/lesson/language.test.ts`, add after the existing checkpoint loop, inside the same `it.each`:

```ts
    for (const question of lesson.quiz ?? []) {
      expect(question.question, `${lesson.id} quiz question`).toMatch(VIETNAMESE)
      expect(question.explanation, `${lesson.id} quiz explanation`).toMatch(VIETNAMESE)
      for (const text of [question.question, question.explanation, ...question.options]) {
        expect(stripCode(text), `${lesson.id} quiz: ${text}`).not.toMatch(ENGLISH_FUNCTION_WORDS)
      }
      // Options stay exempt from the diacritic rule for the same reason checkpoint options
      // are: an option may legitimately be a bare term ("Fanout exchange", "`acks=all`").
    }
```

Then delete the locally-added `describe('nội dung quiz')` block from each of `src/brokers/rabbitmq/lessons/lessons.test.ts`, `src/brokers/redis/lessons/lessons.test.ts` and `src/brokers/kafka/lessons/lessons.test.ts` — the shell-wide tests now cover them, and leaving both means every quiz rule change has to be made in four places.

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything green. A `language.test.ts` failure here is real content to fix, not a test to loosen.

- [ ] **Step 5: Document it**

In `README.md`, wherever lessons and checkpoints are described, record the new rule: every lesson carries three checkpoints and a four-question `quiz`; quiz questions have no `at` and feed both the end-of-lesson dialog and the 20-question per-broker exam; scores live in `localStorage` under `broker-visualizer:progress:v1`; adding a lesson now means adding its quiz, and `src/shell/lesson/quiz.test.ts` enforces it.

- [ ] **Step 6: Commit**

```bash
git add src/shell/lesson src/brokers/rabbitmq/lessons/lessons.test.ts src/brokers/redis/lessons/lessons.test.ts src/brokers/kafka/lessons/lessons.test.ts README.md
git commit -m "test(lessons): require a four-question quiz and three checkpoints for every lesson"
```

---

## Self-Review Notes

- **Spec coverage.** Kho câu hỏi → Task 1. `grade.ts`/`shuffle.ts`/`progress.ts` → Tasks 1-3. Store slice → Task 4. UI (a) checkpoint retry+score → Task 5, (b) end-of-lesson dialog → Tasks 6-7, (c) exam → Tasks 8-10, (d) sidebar badges → Task 10. Content phases → Tasks 11-13. Rule tests + `language.test.ts` → Task 14.
- **Deviation from the spec.** The spec lists `__snapshots__/lessons.test.ts.snap` as a file to update. It is not: those snapshots hold journals only, which quiz content never touches. The plan says so explicitly in Global Constraints and Task 11 Step 4.
- **Naming consistency.** `QuizQuestion`, `QuizResult`, `gradeQuiz`, `shuffle`, `sample`, `Progress`, `ScoreRecord`, `ScoreScope`, `readProgress`, `writeProgress`, `recordScore`, `lessonKey`, `PROGRESS_KEY`, `EXAM_QUESTION_COUNT`, `ExamSource`, `ExamQuestion`, `buildExam`, `recordLessonQuiz`, `recordExam` are each defined once and used with the same signature everywhere after.
- **Names checked against the code while writing this plan**, so no task has to guess: the primary-button classes are `bg-accent … text-accent-fg hover:bg-accent-hover` (`src/shell/ui/Transport/Transport.tsx:44`); `label: string` is on `BrokerModule` (`src/brokers/types.ts:9`), so `broker.label` in Task 10 is real; the three brokers' `lessons.test.ts` files have different top-level shapes (RabbitMQ `describe('every lesson')`, Redis a top-level `describe.each`, Kafka `describe('mọi lesson Kafka')`), which is why Tasks 11-13 append a new top-level `describe` block rather than editing an existing one.
