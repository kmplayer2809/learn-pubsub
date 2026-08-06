import type { BindingSpec, QueueSpec, Topology } from '../../engine'
import { queueArgumentEntries } from './queueArguments'

function queueArguments(queue: QueueSpec | undefined): string {
  const entries = queueArgumentEntries(queue)
  if (entries.length === 0) return '{}'
  const lines = entries.map((entry) => `      ${entry},`)
  return `{\n${lines.join('\n')}\n    }`
}

/**
 * A headers-exchange binding is matched on `headers` (plus `x-match`), not on
 * `routingKey` — `channel.bindQueue`/`bindExchange` take those as the fourth
 * argument. Every other exchange type ignores it, so this is empty for them.
 */
function bindingArguments(binding: BindingSpec): string {
  if (!binding.headers || Object.keys(binding.headers).length === 0) return ''
  const entries = Object.entries(binding.headers).map(([key, value]) => `'${key}': '${value}'`)
  entries.push(`'x-match': '${binding.xMatch ?? 'all'}'`)
  return `, { ${entries.join(', ')} }`
}

export function toAmqplib(topology: Topology): string {
  const lines: string[] = [
    "import amqp from 'amqplib'",
    '',
    'export async function setup() {',
    "  const connection = await amqp.connect('amqp://localhost')",
    '  const channel = await connection.createChannel()',
    '',
  ]

  for (const exchange of topology.exchanges) {
    lines.push(
      `  await channel.assertExchange('${exchange.id}', '${exchange.type}', { durable: true })`,
    )
  }
  lines.push('')

  for (const queue of topology.queues) {
    lines.push(
      `  await channel.assertQueue('${queue.id}', {`,
      `    durable: ${queue.durable ?? false},`,
      `    arguments: ${queueArguments(queue)},`,
      '  })',
    )
  }
  lines.push('')

  for (const binding of topology.bindings) {
    const call = binding.destinationKind === 'queue' ? 'bindQueue' : 'bindExchange'
    lines.push(
      `  await channel.${call}('${binding.destinationId}', '${binding.exchangeId}', '${binding.routingKey ?? ''}'${bindingArguments(binding)})`,
    )
  }
  lines.push('')

  for (const consumer of topology.consumers) {
    lines.push(`  await channel.prefetch(${consumer.prefetch})`, `  await channel.consume('${consumer.queueId}', async (message) => {`, '    if (!message) return')
    if (consumer.autoAck) {
      // noAck: true means the broker already considers the message delivered the
      // instant it's sent — calling channel.ack/nack on it is invalid and throws
      // "unknown delivery tag", so a failure here can only be logged, not acked.
      lines.push(
        '    try {',
        `      // handle ${consumer.label} — auto-ack: the broker will not wait for a confirmation`,
        '    } catch (error) {',
        `      console.error('${consumer.label} failed to process message', error)`,
        '    }',
      )
    } else {
      lines.push(
        '    try {',
        `      // handle ${consumer.label}`,
        '      channel.ack(message)',
        '    } catch (error) {',
        `      channel.nack(message, false, ${consumer.requeueOnNack})`,
        '    }',
      )
    }
    lines.push(`  }, { noAck: ${consumer.autoAck} })`, '')
  }

  lines.push('  return { connection, channel }', '}')
  return lines.join('\n')
}
