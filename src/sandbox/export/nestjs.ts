import type { ConsumerSpec, Topology } from '../../engine'
import { queueArgumentEntries } from './queueArguments'

/**
 * Splits on any run of non-alphanumeric characters, not just `-_.` — lesson
 * consumer labels are prose ("Parking-lot inspector", "Classic consumer"),
 * and a splitter that only knows about `-_.` leaves spaces in the method
 * name, which is not valid TypeScript.
 */
function pascal(label: string): string {
  return label
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** Renders the `queueOptions` body (durable + optional `arguments`) for one consumer's queue. */
function queueOptionsBody(topology: Topology, consumer: ConsumerSpec): string {
  const queue = topology.queues.find((q) => q.id === consumer.queueId)
  const entries = queueArgumentEntries(queue)
  const durable = `      durable: ${queue?.durable ?? false},`
  if (entries.length === 0) return durable
  const argLines = entries.map((entry) => `        ${entry},`).join('\n')
  return [durable, '      arguments: {', argLines, '      },'].join('\n')
}

export function toNestjs(topology: Topology): string {
  const usesManualAck = topology.consumers.some((c) => !c.autoAck)
  const lines: string[] = [
    "import { Injectable } from '@nestjs/common'",
    usesManualAck
      ? "import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'"
      : "import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'",
    '',
    '@Injectable()',
    'export class MessagingHandlers {',
  ]

  for (const consumer of topology.consumers) {
    const binding = topology.bindings.find(
      (b) => b.destinationKind === 'queue' && b.destinationId === consumer.queueId,
    )
    lines.push(
      '  @RabbitSubscribe({',
      `    exchange: '${binding?.exchangeId ?? ''}',`,
      `    routingKey: '${binding?.routingKey ?? ''}',`,
      `    queue: '${consumer.queueId}',`,
      '    queueOptions: {',
      queueOptionsBody(topology, consumer),
      '    },',
      '    allowNonJsonMessages: true,',
      '  })',
      `  async handle${pascal(consumer.label)}(message: unknown): Promise<${consumer.autoAck ? 'void' : 'void | Nack'}> {`,
      `    // ${consumer.label} consumes ${consumer.queueId} with prefetch ${consumer.prefetch}`,
    )
    if (consumer.autoAck) {
      lines.push('    // auto-ack: returning normally is enough, the module acks on success')
    } else {
      lines.push(
        '    try {',
        '      // handle message',
        '    } catch (error) {',
        `      return new Nack(${consumer.requeueOnNack})`,
        '    }',
      )
    }
    lines.push('  }', '')
  }

  lines.push('}')
  lines.push('')
  lines.push('// Register the exchanges and global prefetch in your module:')
  lines.push('// RabbitMQModule.forRoot({')
  lines.push('//   exchanges: [')
  for (const exchange of topology.exchanges) {
    lines.push(`//     { name: '${exchange.id}', type: '${exchange.type}' },`)
  }
  lines.push('//   ],')
  lines.push("//   uri: 'amqp://localhost',")
  lines.push('// })')

  return lines.join('\n')
}
