import type { KafkaTopology } from '../../engine'

/**
 * Splits on any run of non-alphanumeric characters, not just `-_.` — mirrors
 * `rabbitmq/sandbox/export/nestjs.ts`'s `pascal`: node labels are prose ("Consumer A"),
 * and a splitter that only knows about `-_.` leaves spaces in the method name, which is
 * not valid TypeScript.
 */
function pascal(label: string): string {
  return label
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function brokerAddress(id: string): string {
  return `${id}:9092`
}

export function toNestJs(topology: KafkaTopology): string {
  const brokers = topology.brokers.map((b) => `'${brokerAddress(b.id)}'`).join(', ')
  // NestJS' Kafka transport is one client per module registration, configured with a
  // single `consumer.groupId` — real deployments split services by group when they need
  // more than one, so this picks the first group as the module's own and leaves the rest
  // documented on their own `@EventPattern` handlers below.
  const groupId = topology.consumers[0]?.groupId ?? 'default-group'

  const moduleLines = [
    "import { Module } from '@nestjs/common'",
    "import { ClientsModule, Transport } from '@nestjs/microservices'",
    '',
    '@Module({',
    '  imports: [',
    '    ClientsModule.register([',
    '      {',
    "        name: 'KAFKA_SERVICE',",
    '        transport: Transport.KAFKA,',
    '        options: {',
    `          client: { brokers: [${brokers}] },`,
    `          consumer: { groupId: '${groupId}' },`,
    '        },',
    '      },',
    '    ]),',
    '  ],',
    '})',
    'export class MessagingModule {}',
    '',
  ]

  const handlerLines = [
    "import { Controller } from '@nestjs/common'",
    "import { EventPattern, Payload } from '@nestjs/microservices'",
    '',
    '@Controller()',
    'export class MessagingHandlers {',
  ]

  for (const consumer of topology.consumers) {
    for (const topic of consumer.subscriptions) {
      handlerLines.push(
        `  @EventPattern('${topic}')`,
        `  async handle${pascal(consumer.label)}${pascal(topic)}(@Payload() message: unknown): Promise<void> {`,
        `    // ${consumer.label} consumes ${topic} (group ${consumer.groupId})`,
        '  }',
        '',
      )
    }
  }
  handlerLines.push('}')

  return [...moduleLines, ...handlerLines].join('\n')
}
