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
