import type { Lesson } from './types'

export const helloWorld: Lesson = {
  id: '01-hello-world',
  group: 'basics',
  title: 'Hello world',
  summary: 'One publisher, one queue, one consumer, and the default exchange.',
  seed: 1,
  durationMs: 12_000,
  topology: {
    publishers: [{ id: 'p1', label: 'Publisher', position: { x: 40, y: 140 } }],
    exchanges: [{ id: 'default', label: '(default)', type: 'direct', position: { x: 260, y: 140 } }],
    queues: [{ id: 'hello', label: 'hello', kind: 'classic', position: { x: 480, y: 140 } }],
    consumers: [
      {
        id: 'c1',
        label: 'Consumer',
        queueId: 'hello',
        prefetch: 1,
        autoAck: false,
        processingMs: 900,
        jitterMs: 0,
        nackRate: 0,
        requeueOnNack: true,
        position: { x: 700, y: 140 },
      },
    ],
    bindings: [
      {
        id: 'b1',
        exchangeId: 'default',
        destinationId: 'hello',
        destinationKind: 'queue',
        routingKey: 'hello',
      },
    ],
  },
  script: [0, 1500, 3000, 4500].map((at, i) => ({
    at,
    publisherId: 'p1',
    exchangeId: 'default',
    routingKey: 'hello',
    body: `Hello ${i + 1}`,
  })),
  narrative: [
    {
      at: 0,
      title: 'A publisher never writes to a queue',
      body: 'The publisher hands the message to an **exchange**, always. Even the "direct to a queue" case you see in tutorials goes through the *default exchange*, which has an implicit binding to every queue using the queue name as the routing key.',
      highlight: ['p1', 'default'],
    },
    {
      at: 1200,
      title: 'The exchange routes by routing key',
      body: 'This message carries the routing key `hello`. The default exchange is a direct exchange, so it looks for a binding whose key matches exactly, and finds the `hello` queue.',
      highlight: ['default', 'hello'],
    },
    {
      at: 2400,
      title: 'The queue buffers',
      body: 'The queue holds messages until a consumer is ready. Depth grows when publishers outrun consumers — that gap is the entire reason a broker exists.',
      highlight: ['hello'],
    },
    {
      at: 4000,
      title: 'The consumer acknowledges',
      body: 'With `prefetch: 1` and manual ack, the consumer holds exactly one unacked message at a time. Only when it acks does the queue release the next one. Watch the queue drain one message per cycle rather than all at once.',
      highlight: ['c1'],
    },
  ],
  checkpoints: [
    {
      at: 6000,
      question: 'If the consumer stops acking, what happens to the queue?',
      options: [
        'The queue keeps delivering; messages pile up at the consumer',
        'The queue stops delivering after one message and depth grows',
        'The broker drops the extra messages',
      ],
      answerIndex: 1,
      explanation:
        'Prefetch caps unacked messages. At `prefetch: 1`, one unacked message blocks all further delivery to that consumer, so queue depth grows instead.',
    },
  ],
}
