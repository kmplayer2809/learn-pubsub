import { kafka } from './kafka'
import { rabbitmq } from './rabbitmq'
import { redis } from './redis'
import type { AnyBrokerModule } from './types'
import { DEFAULT_BROKER_ID } from './catalog'

export const BROKERS: AnyBrokerModule[] = [rabbitmq, redis, kafka]

export { DEFAULT_BROKER_ID }

export function getBroker(id: string): AnyBrokerModule {
  return BROKERS.find((b) => b.id === id) ?? BROKERS.find((b) => b.id === DEFAULT_BROKER_ID)!
}
