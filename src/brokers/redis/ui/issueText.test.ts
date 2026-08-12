import { describe, expect, it } from 'vitest'
import { validateRedisTopology, type RedisIssueCode, type RedisTopology, type RedisValidationIssue } from '../engine'
import { issueText } from './issueText'

// Every code the engine can currently produce (src/brokers/redis/engine/validate.ts).
// Kept as an explicit list, not derived from the type, so this file physically cannot
// compile once a new code is added to validate.ts without a matching entry landing here.
const ALL_CODES: RedisIssueCode[] = ['client-missing', 'unknown-command', 'no-clients', 'maxmemory-noeviction']

/** Minimal fixture per code, carrying only the fields issueText reads. */
function fixtureFor(code: RedisIssueCode): RedisValidationIssue {
  switch (code) {
    case 'client-missing':
      return { code, severity: 'error', nodeId: 'ghost-client', message: 'english' }
    case 'unknown-command':
      return { code, severity: 'error', nodeId: 'c1', message: 'english' }
    case 'no-clients':
      return { code, severity: 'warning', message: 'english' }
    case 'maxmemory-noeviction':
      return { code, severity: 'warning', nodeId: 'redis', message: 'english' }
  }
}

describe('issueText', () => {
  it('renders every RedisIssueCode the engine can produce', () => {
    for (const code of ALL_CODES) {
      expect(issueText(fixtureFor(code))).toBeTruthy()
    }
  })

  it('never falls back to the engine English sentence', () => {
    for (const code of ALL_CODES) {
      const issue = fixtureFor(code)
      expect(issueText(issue)).not.toBe(issue.message)
    }
  })

  it('keeps Redis terms of art in English inside the Vietnamese sentence', () => {
    const nounByCode: Record<RedisIssueCode, string> = {
      'client-missing': 'client',
      'unknown-command': 'command',
      'no-clients': 'client',
      'maxmemory-noeviction': 'maxmemory',
    }
    for (const code of ALL_CODES) {
      expect(issueText(fixtureFor(code))).toContain(nounByCode[code])
    }
  })

  it('keeps "noeviction" in English', () => {
    expect(issueText(fixtureFor('maxmemory-noeviction'))).toContain('noeviction')
  })

  it('never translates node ids', () => {
    expect(issueText(fixtureFor('client-missing'))).toContain('ghost-client')
    expect(issueText(fixtureFor('unknown-command'))).toContain('c1')
    expect(issueText(fixtureFor('maxmemory-noeviction'))).toContain('redis')
  })

  it('renders the exact repro: a scripted command naming a client that does not exist', () => {
    const topology: RedisTopology = {
      clients: [],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    const issues = validateRedisTopology(topology, [{ at: 0, clientId: 'ghost', name: 'GET', args: ['k'] }])
    const issue = issues.find((i) => i.code === 'client-missing')
    expect(issue).toBeDefined()
    expect(issueText(issue!)).toBe(
      'một command nhắm tới client ghost, nhưng client đó không tồn tại trong topology',
    )
  })
})
