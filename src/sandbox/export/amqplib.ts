import type { BindingSpec, QueueSpec, Topology } from '../../engine'
import { queueArgumentEntries } from './queueArguments'

/** Renders the `arguments:` line for a queue, or '' when it has none to declare. */
function queueArgumentsLine(queue: QueueSpec | undefined): string {
  const entries = queueArgumentEntries(queue)
  if (entries.length === 0) return ''
  const lines = entries.map((entry) => `      ${entry},`)
  return `\n    arguments: {\n${lines.join('\n')}\n    },`
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

/**
 * A JavaScript identifier for a consumer's own channel. Node ids come from the
 * Sandbox (`consumer-3`) or a lesson (`parking-inspector`), so every character
 * that cannot appear in an identifier is folded to an underscore.
 */
function consumerChannelName(consumerId: string): string {
  return `channel_${consumerId.replace(/[^A-Za-z0-9_$]/g, '_')}`
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
      `    durable: ${queue.durable ?? false},${queueArgumentsLine(queue)}`,
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

  const consumerChannels: string[] = []
  for (const consumer of topology.consumers) {
    // One channel per consumer. `prefetch` in amqplib is a CHANNEL-level setting,
    // so emitting several `channel.prefetch(n)` calls against one shared channel
    // silently applies the last value to every consumer — exported 08-prefetch code
    // would run all three consumers at the same prefetch and reproduce none of what
    // the lesson demonstrates.
    const channelVar = consumerChannelName(consumer.id)
    consumerChannels.push(channelVar)
    lines.push(
      `  const ${channelVar} = await connection.createChannel()`,
      `  await ${channelVar}.prefetch(${consumer.prefetch})`,
      `  await ${channelVar}.consume('${consumer.queueId}', async (message) => {`,
      '    if (!message) return',
    )
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
        `      ${channelVar}.ack(message)`,
        '    } catch (error) {',
        `      ${channelVar}.nack(message, false, ${consumer.requeueOnNack})`,
        '    }',
      )
    }
    lines.push(`  }, { noAck: ${consumer.autoAck} })`, '')
  }

  lines.push(`  return { connection, channel, consumerChannels: [${consumerChannels.join(', ')}] }`, '}')
  return lines.join('\n')
}
