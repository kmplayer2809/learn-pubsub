import type { SimEvent } from './types'

/**
 * A binary min-heap ordered by (at, seq). Copy-on-write so engine state stays
 * immutable and rewinding by replay is safe.
 */
export interface Scheduler {
  readonly heap: readonly SimEvent[]
}

export function createScheduler(): Scheduler {
  return { heap: [] }
}

function before(a: SimEvent, b: SimEvent): boolean {
  return a.at !== b.at ? a.at < b.at : a.seq < b.seq
}

function siftUp(heap: SimEvent[], start: number): void {
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

function siftDown(heap: SimEvent[], start: number): void {
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

export function push(scheduler: Scheduler, event: SimEvent): Scheduler {
  const heap = scheduler.heap.slice()
  heap.push(event)
  siftUp(heap, heap.length - 1)
  return { heap }
}

export function pushAll(scheduler: Scheduler, events: readonly SimEvent[]): Scheduler {
  return events.reduce(push, scheduler)
}

export function peekTime(scheduler: Scheduler): number | undefined {
  return scheduler.heap[0]?.at
}

function pop(heap: SimEvent[]): SimEvent | undefined {
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
export function popDue(scheduler: Scheduler, upToInclusive: number): [SimEvent[], Scheduler] {
  const heap = scheduler.heap.slice()
  const due: SimEvent[] = []
  while (heap.length > 0 && heap[0]!.at <= upToInclusive) {
    due.push(pop(heap)!)
  }
  return [due, { heap }]
}
