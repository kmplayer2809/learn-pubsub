import { describe, expect, it } from 'vitest'
import { validateKafkaTopology, type KafkaIssueCode, type KafkaTopology, type KafkaValidationIssue } from '../engine'
import { issueText } from './issueText'

// Every code the engine can currently produce (src/brokers/kafka/engine/validate.ts).
// Kept as an explicit list, not derived from the type, so this file physically cannot
// compile once a new code is added to validate.ts without a matching entry landing here.
const ALL_CODES: KafkaIssueCode[] = [
  'replication-factor-too-high',
  'min-insync-too-high',
  'unknown-topic',
  'transactional-not-idempotent',
  'unknown-controller',
  'duplicate-id',
  'unknown-producer',
  'unknown-consumer',
  'idle-consumers',
  'topic-unproduced',
  'topic-unconsumed',
  'acks-zero-idempotent',
]

/** Minimal fixture per code, carrying only the fields issueText reads. */
function fixtureFor(code: KafkaIssueCode): KafkaValidationIssue {
  switch (code) {
    case 'replication-factor-too-high':
      return { code, severity: 'error', message: 'orders: 3 > 1' }
    case 'min-insync-too-high':
      return { code, severity: 'error', message: 'orders: 2 > 1' }
    case 'unknown-topic':
      return { code, severity: 'error', nodeId: 'c1', message: 'ghost-topic' }
    case 'transactional-not-idempotent':
      return { code, severity: 'error', nodeId: 'p1', message: 'txn-1' }
    case 'unknown-controller':
      return { code, severity: 'error', message: 'ghost-broker' }
    case 'duplicate-id':
      return { code, severity: 'error', nodeId: 'dup-1', message: 'id dup-1' }
    case 'unknown-producer':
      return { code, severity: 'error', message: 'ghost-producer' }
    case 'unknown-consumer':
      return { code, severity: 'error', message: 'ghost-consumer' }
    case 'idle-consumers':
      return { code, severity: 'warning', message: 'g1: 3 consumer / 1 partition' }
    case 'topic-unproduced':
      return { code, severity: 'warning', message: 'orders' }
    case 'topic-unconsumed':
      return { code, severity: 'warning', message: 'orders' }
    case 'acks-zero-idempotent':
      return { code, severity: 'warning', nodeId: 'p1', message: 'p1' }
  }
}

describe('issueText', () => {
  it('mọi mã issue đều có câu tiếng Việt riêng', () => {
    const codes: KafkaIssueCode[] = [
      'replication-factor-too-high',
      'min-insync-too-high',
      'unknown-topic',
      'transactional-not-idempotent',
      'unknown-controller',
      'duplicate-id',
      'unknown-producer',
      'unknown-consumer',
      'idle-consumers',
      'topic-unproduced',
      'topic-unconsumed',
      'acks-zero-idempotent',
    ]
    const texts = codes.map((code) => issueText({ code, severity: 'error', message: 'x' }))
    expect(new Set(texts).size).toBe(codes.length)
    for (const text of texts) {
      expect(text).toMatch(
        /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i,
      )
    }
  })

  it('renders every KafkaIssueCode the engine can produce', () => {
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

  it('keeps Kafka terms of art in English inside the Vietnamese sentence', () => {
    const termByCode: Record<KafkaIssueCode, string> = {
      'replication-factor-too-high': 'replicationFactor',
      'min-insync-too-high': 'min.insync.replicas',
      'unknown-topic': 'topic',
      'transactional-not-idempotent': 'transactionalId',
      'unknown-controller': 'controllerBrokerId',
      'duplicate-id': 'id',
      'unknown-producer': 'produce',
      'unknown-consumer': 'consumer',
      'idle-consumers': 'consumer',
      'topic-unproduced': 'produce',
      'topic-unconsumed': 'consumer',
      'acks-zero-idempotent': 'acks',
    }
    for (const code of ALL_CODES) {
      expect(issueText(fixtureFor(code))).toContain(termByCode[code])
    }
  })

  it('never translates node ids or the engine message payload', () => {
    expect(issueText(fixtureFor('unknown-topic'))).toContain('c1')
    expect(issueText(fixtureFor('unknown-topic'))).toContain('ghost-topic')
    expect(issueText(fixtureFor('duplicate-id'))).toContain('dup-1')
    expect(issueText(fixtureFor('acks-zero-idempotent'))).toContain('p1')
  })

  it('renders the exact repro: a topic whose replicationFactor exceeds the broker count', () => {
    const topology: KafkaTopology = {
      brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
      topics: [{ name: 'orders', partitions: 1, replicationFactor: 3 }],
      producers: [],
      consumers: [],
      controllerBrokerId: 'b1',
    }
    const issues = validateKafkaTopology(topology, [])
    const issue = issues.find((i) => i.code === 'replication-factor-too-high')
    expect(issue).toBeDefined()
    expect(issueText(issue!)).toBe(
      '`replicationFactor` lớn hơn số broker đang có (orders: 3 > 1) — không đủ broker để giữ đủ bản sao.',
    )
  })
})
