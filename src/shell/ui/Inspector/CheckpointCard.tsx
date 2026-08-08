import { useState } from 'react'
import type { Checkpoint } from '../../lesson/types'
import { Markdown, MarkdownInline } from './Markdown'

/**
 * One checkpoint quiz. The chosen answer is local state with no reset logic of its own —
 * see `CheckpointSection`, which keys each card so React discards the state instead.
 *
 * Answering is one-way on purpose: the checkpoint is a comprehension beat inside a lesson,
 * not a graded exercise, so there is no score and no retry. Once an option is clicked the
 * whole set is disabled, the chosen option is marked right or wrong, the correct option is
 * marked regardless of what was chosen, and the explanation appears.
 */
export function CheckpointCard({ checkpoint }: { checkpoint: Checkpoint }) {
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const answered = chosen !== undefined
  const isCorrect = chosen === checkpoint.answerIndex

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-2" data-testid="checkpoint-card">
      <p className="mb-2 text-sm leading-relaxed text-slate-200">
        <MarkdownInline text={checkpoint.question} />
      </p>

      <ul className="space-y-1">
        {checkpoint.options.map((option, i) => {
          const isAnswer = i === checkpoint.answerIndex
          const isChosen = i === chosen
          return (
            <li key={i}>
              <button
                type="button"
                disabled={answered}
                onClick={() => setChosen(i)}
                data-testid={`checkpoint-option-${i}`}
                className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                  answered
                    ? isAnswer
                      ? 'border-emerald-600 bg-emerald-950 text-emerald-100'
                      : isChosen
                        ? 'border-rose-600 bg-rose-950 text-rose-100'
                        : 'border-slate-800 text-slate-500'
                    : 'border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <MarkdownInline text={option} />
                {answered && isAnswer && (
                  <span className="ml-1 text-[10px] text-emerald-300">· Đáp án đúng</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {answered && (
        <div className="mt-2">
          <p
            data-testid="checkpoint-verdict"
            className={`mb-1 text-[11px] font-semibold ${isCorrect ? 'text-emerald-300' : 'text-rose-300'}`}
          >
            {isCorrect ? 'Đúng' : 'Chưa đúng'}
          </p>
          <div data-testid="checkpoint-explanation">
            <Markdown text={checkpoint.explanation} />
          </div>
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
  const visible = checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => now >= checkpoint.at)
    .sort((a, b) => a.checkpoint.at - b.checkpoint.at)

  if (visible.length === 0) return null

  return (
    <section className="space-y-2" data-testid="checkpoints">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-500">Câu hỏi kiểm tra</h3>
      {visible.map(({ checkpoint, index }) => (
        <CheckpointCard key={`${lessonId}:${index}`} checkpoint={checkpoint} />
      ))}
    </section>
  )
}
