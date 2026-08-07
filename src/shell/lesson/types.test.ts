import { describe, expect, it } from 'vitest'
import type { Lesson } from './types'

describe('Lesson', () => {
  it('carries a broker-specific topology and script without the shell knowing either', () => {
    interface KeyspaceTopology { keys: string[] }
    interface SetCommand { at: number; key: string; value: string }

    const lesson: Lesson<KeyspaceTopology, SetCommand> = {
      id: '01-strings',
      group: 'basics',
      title: 'String',
      summary: 'Key và value đơn giản nhất.',
      topology: { keys: ['user:1'] },
      script: [{ at: 0, key: 'user:1', value: 'alice' }],
      narrative: [{ at: 0, title: 'SET ghi đè', body: 'Lệnh `SET` ghi đè không cần hỏi.' }],
      seed: 1,
      durationMs: 5000,
    }

    expect(lesson.script[0]!.key).toBe('user:1')
    expect(lesson.narrative[0]!.highlight).toBeUndefined()
  })
})
