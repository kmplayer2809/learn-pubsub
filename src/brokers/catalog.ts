/**
 * Plain broker facts the shell needs at module-evaluation time. This file must
 * never import a component, an engine, or `registry.ts` — importing any of them
 * would recreate the cycle this file exists to break.
 */
export interface BrokerCatalogEntry {
  id: string
  label: string
  defaultLessonId: string
}

export const BROKER_CATALOG: BrokerCatalogEntry[] = [
  { id: 'rabbitmq', label: 'RabbitMQ', defaultLessonId: '01-hello-world' },
  { id: 'redis', label: 'Redis', defaultLessonId: '01-strings' },
]

export const DEFAULT_BROKER_ID = 'rabbitmq'

export function catalogEntry(id: string): BrokerCatalogEntry {
  return BROKER_CATALOG.find((b) => b.id === id)
    ?? BROKER_CATALOG.find((b) => b.id === DEFAULT_BROKER_ID)!
}
