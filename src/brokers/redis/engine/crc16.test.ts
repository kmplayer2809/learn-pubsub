import { describe, expect, it } from 'vitest'
import { keySlot } from './crc16'

describe('keySlot', () => {
  it('is deterministic for the same key', () => {
    expect(keySlot('user:1000')).toBe(keySlot('user:1000'))
  })

  it('stays within the 16384-slot range', () => {
    for (const key of ['a', 'user:1000', '', 'x'.repeat(500)]) {
      const slot = keySlot(key)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(slot).toBeLessThan(16384)
    }
  })

  it('hashes only the {tag} portion when a hash tag is present, so related keys land on the same slot', () => {
    expect(keySlot('{user1000}.following')).toBe(keySlot('{user1000}.followers'))
    expect(keySlot('{user1000}.following')).toBe(keySlot('user1000')) // hashing "user1000" directly matches the tag's contents
  })

  it('falls back to hashing the whole key when there is no {tag}, or an empty/unclosed one', () => {
    expect(keySlot('plainkey')).not.toBe(keySlot('{}plainkey')) // "{}" has no content between braces, so this hashes "{}plainkey" whole
    expect(() => keySlot('no-closing-brace{')).not.toThrow()
  })
})
