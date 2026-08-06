import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LESSONS } from '../../lessons/registry'
import { Markdown } from './Markdown'

describe('Markdown', () => {
  it('renders bold, italic and code without leaking their markers', () => {
    const { container } = render(
      <Markdown text="A **bold** and an *emphasised* run with `code` in it." />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('emphasised')
    expect(container.querySelector('code')?.textContent).toBe('code')
    // The whole point: no marker characters survive into the rendered text.
    expect(container.textContent).toBe('A bold and an emphasised run with code in it.')
  })

  it('does not mistake bold for italic', () => {
    const { container } = render(<Markdown text="**strong only**" />)
    expect(container.querySelector('strong')?.textContent).toBe('strong only')
    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toBe('strong only')
  })

  it('splits on blank lines into separate paragraphs', () => {
    const { container } = render(<Markdown text={'first para\n\nsecond para'} />)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('leaves no unrendered markdown markers in any lesson narrative', () => {
    // Lesson bodies are hand-written markdown and sixteen more arrive across
    // Tasks 15-17. A construct the renderer does not support shows up in the
    // inspector as literal asterisks or backticks, which is how `*default
    // exchange*` shipped visible in lesson 01.
    let checked = 0
    for (const lesson of LESSONS) {
      for (const step of lesson.narrative) {
        const { container } = render(<Markdown text={step.body} />)
        expect(container.textContent, `${lesson.id} @${step.at}`).not.toMatch(/\*|`/)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
