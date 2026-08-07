import { describe, expect, it } from 'vitest'
import { LESSONS, LESSON_GROUPS } from './registry'

/** Any Vietnamese letter carrying a diacritic. */
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

/**
 * Untranslated English prose reveals itself through function words that have no
 * Vietnamese homograph. Checked outside code spans, because a lesson may legitimately
 * quote English inside backticks.
 */
const ENGLISH_FUNCTION_WORDS = /\b(the|and|with|that|which|from|into|because|however)\b/i

function stripCode(text: string): string {
  return text.replace(/`[^`]*`/g, ' ')
}

describe('reader-facing copy is Vietnamese', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
    // Prose, not individual titles: a title like "Fanout exchange" is legitimately all
    // English terms, so requiring a diacritic per title would distort the copy. Bodies
    // are full sentences and always carry Vietnamese connective tissue.
    const prose = lesson.narrative.map((s) => s.body).join('\n')
    expect(prose).toMatch(VIETNAMESE)
    expect(lesson.summary).toMatch(VIETNAMESE)
    expect(stripCode(lesson.summary), `${lesson.id} summary`).not.toMatch(
      ENGLISH_FUNCTION_WORDS,
    )

    // Each body individually, not just the joined blob: one Vietnamese word in step 1
    // must not vouch for three untranslated steps after it.
    for (const step of lesson.narrative) {
      expect(step.body, `${lesson.id} @${step.at} body`).toMatch(VIETNAMESE)
    }

    for (const step of lesson.narrative) {
      expect(stripCode(step.body), `${lesson.id} @${step.at} body`).not.toMatch(
        ENGLISH_FUNCTION_WORDS,
      )
      expect(stripCode(step.title), `${lesson.id} @${step.at} title`).not.toMatch(
        ENGLISH_FUNCTION_WORDS,
      )
    }

    for (const cp of lesson.checkpoints ?? []) {
      expect(cp.question).toMatch(VIETNAMESE)
      expect(cp.explanation).toMatch(VIETNAMESE)
      for (const text of [cp.question, cp.explanation, ...cp.options]) {
        expect(stripCode(text), `${lesson.id} checkpoint: ${text}`).not.toMatch(
          ENGLISH_FUNCTION_WORDS,
        )
      }
      // Options are short and may legitimately be a bare term ("Fanout exchange"), so
      // they are held to the forbidden-word rule but not to the diacritic rule.
    }
  })

  it('labels the lesson groups in Vietnamese', () => {
    // 'Dead-letter & retry' is a term, not prose, so it is exempt from the diacritic
    // rule; the others must carry one.
    const labels = LESSON_GROUPS.map((g) => g.label)
    expect(labels).toContain('Cơ bản')
    expect(labels).toContain('Độ tin cậy')
    expect(labels).toContain('Pattern nâng cao')
  })
})
