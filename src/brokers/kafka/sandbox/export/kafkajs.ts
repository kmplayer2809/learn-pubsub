import type { KafkaProducerSpec, KafkaTopology } from '../../engine'

/** No broker in `KafkaBrokerSpec` carries a real network address (it only exists on
 *  canvas), so exported code needs a placeholder the same way RabbitMQ's `toAmqplib`
 *  hardcodes `amqp://localhost` — 9092 is Kafka's own default broker port. */
function brokerAddress(id: string): string {
  return `${id}:9092`
}

/** A JavaScript identifier for a node's own client variable — node ids come from the
 *  Sandbox (`producer-3`) or a lesson (`p1`), so anything not a valid identifier
 *  character is folded to an underscore, mirroring `amqplib.ts`'s `consumerChannelName`. */
function identifier(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^A-Za-z0-9_$]/g, '_')}`
}

/** KafkaJS's `producer.send` takes `acks` as a number (-1 = all, 0, 1), not the
 *  `0 | 1 | 'all'` union this app's `KafkaProducerSpec` uses — 'all' and the unset
 *  default both mean -1, matching the engine's own default (`engine/types.ts`). */
function acksValue(acks: KafkaProducerSpec['acks']): number {
  if (acks === undefined || acks === 'all') return -1
  return acks
}

export function toKafkaJs(topology: KafkaTopology): string {
  const brokers = topology.brokers.map((b) => `'${brokerAddress(b.id)}'`).join(', ')
  const lines: string[] = [
    "import { Kafka } from 'kafkajs'",
    '',
    'export async function setup() {',
    `  const kafka = new Kafka({ clientId: 'app', brokers: [${brokers}] })`,
    '',
  ]

  if (topology.topics.length > 0) {
    lines.push(
      '  const admin = kafka.admin()',
      '  await admin.connect()',
      '  await admin.createTopics({',
      '    topics: [',
      ...topology.topics.map(
        (t) =>
          `      { topic: '${t.name}', numPartitions: ${t.partitions}, replicationFactor: ${t.replicationFactor} },`,
      ),
      '    ],',
      '  })',
      '  await admin.disconnect()',
      '',
    )
  }

  const producerVars: string[] = []
  for (const producer of topology.producers) {
    const varName = identifier('producer', producer.id)
    producerVars.push(varName)
    const opts: string[] = []
    if (producer.idempotent) opts.push('idempotent: true')
    if (producer.transactionalId) opts.push(`transactionalId: '${producer.transactionalId}'`)
    if (producer.maxInFlight !== undefined) opts.push(`maxInFlightRequests: ${producer.maxInFlight}`)
    lines.push(
      `  const ${varName} = kafka.producer(${opts.length > 0 ? `{ ${opts.join(', ')} }` : ''})`,
      `  await ${varName}.connect()`,
      // `acks` is a per-call option on `send`, not a `producer()` constructor option in
      // KafkaJS — there is no topic to send to without a script command, so this stays a
      // commented example rather than a call this function could actually run.
      `  // await ${varName}.send({ topic: '<topic>', acks: ${acksValue(producer.acks)}, messages: [{ value: 'hello' }] })`,
      '',
    )
  }

  const consumerVars: string[] = []
  for (const consumer of topology.consumers) {
    const varName = identifier('consumer', consumer.id)
    consumerVars.push(varName)
    const fromBeginning = (consumer.autoOffsetReset ?? 'latest') === 'earliest'
    lines.push(`  const ${varName} = kafka.consumer({ groupId: '${consumer.groupId}' })`, `  await ${varName}.connect()`)
    // One `subscribe` call per topic — KafkaJS accepts an array too, but a single call
    // per topic keeps the exported code legible about exactly which topics feed this
    // consumer, one line each.
    for (const topic of consumer.subscriptions) {
      lines.push(`  await ${varName}.subscribe({ topic: '${topic}', fromBeginning: ${fromBeginning} })`)
    }
    // `maxPollRecords` has no direct KafkaJS analogue; > 1 records per poll is what
    // `eachBatch` (a whole `batch.messages` per callback) models, vs. `eachMessage`
    // (exactly one record per callback) for the default of 1.
    if ((consumer.maxPollRecords ?? 1) > 1) {
      lines.push(
        `  await ${varName}.run({`,
        '    eachBatch: async ({ batch }) => {',
        `      // handle ${consumer.label} — batch.messages, up to ${consumer.maxPollRecords} records`,
        '    },',
        '  })',
        '',
      )
    } else {
      lines.push(
        `  await ${varName}.run({`,
        '    eachMessage: async ({ topic, partition, message }) => {',
        `      // handle ${consumer.label}`,
        '    },',
        '  })',
        '',
      )
    }
  }

  lines.push(`  return { kafka, producers: [${producerVars.join(', ')}], consumers: [${consumerVars.join(', ')}] }`, '}')
  return lines.join('\n')
}
