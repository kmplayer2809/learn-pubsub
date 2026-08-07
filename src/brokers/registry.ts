import { rabbitmq } from './rabbitmq'
import type { AnyBrokerModule } from './types'

export const BROKERS: AnyBrokerModule[] = [rabbitmq]

export const DEFAULT_BROKER_ID = 'rabbitmq'

export function getBroker(id: string): AnyBrokerModule {
  return BROKERS.find((b) => b.id === id) ?? BROKERS.find((b) => b.id === DEFAULT_BROKER_ID)!
}
