import type { SimEvent } from './types'

/**
 * A binary min-heap ordered by (at, seq). Copy-on-write so engine state stays
 * immutable and rewinding by replay is safe.
 */
export interface Scheduler<T extends string = string> {
  readonly heap: readonly SimEvent<T>[]
}

export function createScheduler<T extends string = string>(): Scheduler<T> {
  return { heap: [] }
}

function before<T extends string>(a: SimEvent<T>, b: SimEvent<T>): boolean {
  return a.at !== b.at ? a.at < b.at : a.seq < b.seq
}

function siftUp<T extends string>(heap: SimEvent<T>[], start: number): void {
  let i = start
  while (i > 0) {
    const parent = (i - 1) >> 1
    const node = heap[i]!
    const parentNode = heap[parent]!
    if (!before(node, parentNode)) break
    heap[i] = parentNode
    heap[parent] = node
    i = parent
  }
}

function siftDown<T extends string>(heap: SimEvent<T>[], start: number): void {
  let i = start
  const n = heap.length
  for (;;) {
    const left = i * 2 + 1
    const right = left + 1
    let smallest = i
    if (left < n && before(heap[left]!, heap[smallest]!)) smallest = left
    if (right < n && before(heap[right]!, heap[smallest]!)) smallest = right
    if (smallest === i) break
    const tmp = heap[i]!
    heap[i] = heap[smallest]!
    heap[smallest] = tmp
    i = smallest
  }
}

export function push<T extends string>(scheduler: Scheduler<T>, event: SimEvent<T>): Scheduler<T> {
  const heap = scheduler.heap.slice()
  heap.push(event)
  siftUp(heap, heap.length - 1)
  return { heap }
}

export function pushAll<T extends string>(scheduler: Scheduler<T>, events: readonly SimEvent<T>[]): Scheduler<T> {
  return events.reduce<Scheduler<T>>(push, scheduler)
}

export function peekTime<T extends string>(scheduler: Scheduler<T>): number | undefined {
  return scheduler.heap[0]?.at
}

function pop<T extends string>(heap: SimEvent<T>[]): SimEvent<T> | undefined {
  if (heap.length === 0) return undefined
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    siftDown(heap, 0)
  }
  return top
}

/** Removes and returns every event at or before `upToInclusive`, in order. */
export function popDue<T extends string>(scheduler: Scheduler<T>, upToInclusive: number): [SimEvent<T>[], Scheduler<T>] {
  const heap = scheduler.heap.slice()
  const due: SimEvent<T>[] = []
  while (heap.length > 0 && heap[0]!.at <= upToInclusive) {
    due.push(pop(heap)!)
  }
  return [due, { heap }]
}
