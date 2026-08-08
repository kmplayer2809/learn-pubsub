import { describe, expect, it } from 'vitest'
import { validateTopology, type Topology, type ValidationIssue, type ValidationIssueCode } from '../engine'
import { vietnameseIssueMessage } from './issueText'

// Every code the engine can currently produce (src/engine/validate.ts). Kept
// as an explicit list, not derived from the type, so this file physically
// cannot compile once a new code is added to validate.ts without a matching
// entry landing here too.
const ALL_CODES: ValidationIssueCode[] = [
  'binding-missing-exchange',
  'binding-missing-destination',
  'dead-letter-exchange-missing',
  'self-dead-letter-cycle',
  'queue-unreachable',
  'consumer-missing-queue',
]

/** Minimal fixture per code, carrying only the fields vietnameseIssueMessage reads. */
function fixtureFor(code: ValidationIssueCode): ValidationIssue {
  switch (code) {
    case 'binding-missing-exchange':
      return { code, nodeId: 'ex', severity: 'error', message: 'english', bindingId: 'b1', exchangeId: 'ex' }
    case 'binding-missing-destination':
      return {
        code,
        nodeId: 'ghost',
        severity: 'error',
        message: 'english',
        bindingId: 'b1',
        destinationId: 'ghost',
      }
    case 'dead-letter-exchange-missing':
      return {
        code,
        nodeId: 'q1',
        severity: 'error',
        message: 'english',
        queueId: 'q1',
        queueLabel: 'work',
        deadLetterExchange: 'nope',
      }
    case 'self-dead-letter-cycle':
      return { code, nodeId: 'q1', severity: 'warning', message: 'english', queueId: 'q1', queueLabel: 'work' }
    case 'queue-unreachable':
      return { code, nodeId: 'q2', severity: 'warning', message: 'english', queueId: 'q2', queueLabel: 'orphan' }
    case 'consumer-missing-queue':
      return {
        code,
        nodeId: 'c1',
        severity: 'error',
        message: 'english',
        consumerId: 'c1',
        consumerLabel: 'worker',
        queueId: 'ghost',
      }
  }
}

describe('vietnameseIssueMessage', () => {
  it('renders every ValidationIssue code the engine can produce', () => {
    for (const code of ALL_CODES) {
      const rendered = vietnameseIssueMessage(fixtureFor(code))
      expect(rendered).toBeTruthy()
    }
  })

  it('never falls back to the engine English sentence', () => {
    for (const code of ALL_CODES) {
      const issue = fixtureFor(code)
      expect(vietnameseIssueMessage(issue)).not.toBe(issue.message)
    }
  })

  it('keeps RabbitMQ nouns in English inside the Vietnamese sentence', () => {
    const nounByCode: Record<ValidationIssueCode, string> = {
      'binding-missing-exchange': 'exchange',
      'binding-missing-destination': 'binding',
      'dead-letter-exchange-missing': 'dead-letter',
      'self-dead-letter-cycle': 'dead-letter',
      'queue-unreachable': 'binding',
      'consumer-missing-queue': 'consumer',
    }
    for (const code of ALL_CODES) {
      expect(vietnameseIssueMessage(fixtureFor(code))).toContain(nounByCode[code])
    }
  })

  it('never translates node ids or labels', () => {
    expect(vietnameseIssueMessage(fixtureFor('queue-unreachable'))).toContain('orphan')
    expect(vietnameseIssueMessage(fixtureFor('consumer-missing-queue'))).toContain('ghost')
  })

  it('renders the exact Sandbox repro: an orphan queue with no binding', () => {
    const topology: Topology = {
      publishers: [{ id: 'publisher-1', label: 'Publisher', position: { x: 0, y: 0 } }],
      exchanges: [{ id: 'exchange-2', label: 'exchange-2', type: 'direct', position: { x: 200, y: 0 } }],
      queues: [{ id: 'queue-3', label: 'queue-3', kind: 'classic', position: { x: 400, y: 0 } }],
      consumers: [],
      bindings: [],
    }
    const [issue] = validateTopology(topology)
    expect(issue).toBeDefined()
    expect(issue!.code).toBe('queue-unreachable')
    expect(vietnameseIssueMessage(issue!)).toBe(
      'queue queue-3 chưa có binding nào, nên không message nào tới được',
    )
  })
})
