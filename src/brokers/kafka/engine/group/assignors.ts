import type { GroupMember, TopicPartition } from '../types'

export type AssignorName = 'range' | 'round-robin' | 'sticky' | 'cooperative-sticky'

export type Assignment = Record<string, TopicPartition[]>

const byTopicThenPartition = (a: TopicPartition, b: TopicPartition): number =>
  a.topic === b.topic ? a.partition - b.partition : a.topic.localeCompare(b.topic)

const partitionKey = (p: TopicPartition): string => `${p.topic}-${p.partition}`

/**
 * `members` sorted by `memberId`, `partitions` sorted by `(topic, partition)` — the
 * coordinator calls `assign` with members in join order, and join order depends on
 * jitter (`rng.ts`), so every assignor below must consume already-canonical inputs
 * instead of trusting caller order. Sorting here, once, is what makes every assignor
 * a pure function of the *sets* of members and partitions rather than of their order.
 */
function canonicalize(
  members: GroupMember[],
  partitions: TopicPartition[],
): { members: GroupMember[]; partitions: TopicPartition[] } {
  return {
    members: [...members].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    partitions: [...partitions].sort(byTopicThenPartition),
  }
}

/** Partitions grouped by topic, in the topic order they first appear. Because the
 *  input is already sorted by `(topic, partition)`, that first-seen order is simply
 *  alphabetical — no separate topic sort needed. */
function groupByTopic(partitions: TopicPartition[]): Map<string, TopicPartition[]> {
  const groups = new Map<string, TopicPartition[]>()
  for (const p of partitions) {
    const group = groups.get(p.topic)
    if (group) group.push(p)
    else groups.set(p.topic, [p])
  }
  return groups
}

/**
 * Range assignor: per topic, split its partitions into contiguous runs and hand the
 * runs to the members subscribed to that topic (in `memberId` order). The extra
 * `count % n` partitions go to the *first* members, not spread out — that lump is
 * the classic range weakness real Kafka has always had, and exactly what the second
 * test (and lesson 13) exists to make visible: a topic whose partition count is not
 * a multiple of the consumer count leaves a permanent one-partition-heavier consumer.
 */
function rangeAssign(members: GroupMember[], partitions: TopicPartition[], result: Assignment): void {
  for (const [topic, topicPartitions] of groupByTopic(partitions)) {
    const subscribed = members.filter((m) => m.subscriptions.includes(topic))
    const n = subscribed.length
    if (n === 0) continue
    const perMember = Math.floor(topicPartitions.length / n)
    const extra = topicPartitions.length % n
    let cursor = 0
    subscribed.forEach((m, i) => {
      const count = perMember + (i < extra ? 1 : 0)
      result[m.memberId]!.push(...topicPartitions.slice(cursor, cursor + count))
      cursor += count
    })
  }
}

/**
 * Round-robin assignor: a single cursor walks the sorted member list once per
 * partition (in `(topic, partition)` order), skipping members not subscribed to
 * that partition's topic, and never resetting between partitions — that's what
 * keeps it a genuine round-robin instead of restarting from `members[0]` every
 * topic (which would just be range assignment in disguise for uniform subscriptions).
 */
function roundRobinAssign(members: GroupMember[], partitions: TopicPartition[], result: Assignment): void {
  const n = members.length
  if (n === 0) return
  let cursor = 0
  for (const p of partitions) {
    let attempts = 0
    while (attempts < n && !members[cursor % n]!.subscriptions.includes(p.topic)) {
      cursor++
      attempts++
    }
    if (attempts === n) continue // no member subscribes to this topic — nothing to assign
    const chosen = members[cursor % n]!
    result[chosen.memberId]!.push(p)
    cursor++
  }
}

/**
 * Sticky assignor, scoped per topic like `rangeAssign` above. Real Kafka's
 * StickyAssignor solves one global bin-packing problem across every subscribed
 * topic at once, balancing total partition *count* per member even when members
 * subscribe to different topic sets; per-topic scoping is the simplification this
 * teaching app makes; it matches real Kafka whenever every member in a group
 * subscribes to the same topic(s), which is every assignor test and lesson 13's
 * scenario, but would under-balance a group with heterogeneous subscriptions.
 *
 * Two phases, in order:
 *  1. Retain: each member keeps up to `quota = ceil(topicCount / n)` of the
 *     partitions it already owns (lowest partition number first, for determinism —
 *     the spec only requires *some* deterministic subset). Partitions beyond quota,
 *     and partitions nobody owns yet, fall into a pool.
 *  2. Refill: the pool is handed out via the same skip-when-at-quota cursor as
 *     `roundRobinAssign`, so members are topped up round-robin rather than one
 *     member being filled to quota before the next is touched — that distinction
 *     is what keeps the final spread within 1 of balanced instead of lumpy.
 */
function stickyAssign(members: GroupMember[], partitions: TopicPartition[], result: Assignment): void {
  for (const [topic, topicPartitions] of groupByTopic(partitions)) {
    const subscribed = members.filter((m) => m.subscriptions.includes(topic))
    const n = subscribed.length
    if (n === 0) continue
    const quota = Math.ceil(topicPartitions.length / n)
    const validPartitions = new Set(topicPartitions.map((p) => p.partition))
    const claimed = new Set<number>()

    const kept = new Map<string, TopicPartition[]>()
    for (const m of subscribed) {
      const owned = m.assignment
        .filter((p) => p.topic === topic && validPartitions.has(p.partition))
        .sort((a, b) => a.partition - b.partition)
        .slice(0, quota)
      kept.set(m.memberId, owned)
      for (const p of owned) claimed.add(p.partition)
    }

    const pool = topicPartitions.filter((p) => !claimed.has(p.partition))
    let cursor = 0
    for (const p of pool) {
      let attempts = 0
      while (attempts < n && kept.get(subscribed[cursor % n]!.memberId)!.length >= quota) {
        cursor++
        attempts++
      }
      if (attempts === n) break // every subscriber already at quota — cannot happen since quota is a ceiling
      const m = subscribed[cursor % n]!
      kept.get(m.memberId)!.push(p)
      cursor++
    }

    for (const m of subscribed) result[m.memberId]!.push(...kept.get(m.memberId)!)
  }
}

export function assign(name: AssignorName, members: GroupMember[], partitions: TopicPartition[]): Assignment {
  const { members: sortedMembers, partitions: sortedPartitions } = canonicalize(members, partitions)

  const result: Assignment = {}
  for (const m of sortedMembers) result[m.memberId] = []

  switch (name) {
    case 'range':
      rangeAssign(sortedMembers, sortedPartitions, result)
      break
    case 'round-robin':
      roundRobinAssign(sortedMembers, sortedPartitions, result)
      break
    // Cooperative-sticky's only difference from plain sticky is *how* the group gets
    // from the old assignment to the new one — a two-round revoke-then-grant protocol
    // so no partition is ever double-processed mid-rebalance. That protocol lives in
    // the coordinator (Task 2), which calls `revocationsFor` between rounds; the
    // target assignment itself is identical, so both names resolve to the same
    // function here.
    case 'sticky':
    case 'cooperative-sticky':
      stickyAssign(sortedMembers, sortedPartitions, result)
      break
  }

  for (const memberId of Object.keys(result)) {
    result[memberId]!.sort(byTopicThenPartition)
  }

  return result
}

/**
 * Only meaningful for cooperative-sticky: the coordinator revokes exactly the
 * partitions a member is losing (never partitions it keeps or partitions it never
 * had) before granting anyone the newly-freed ones, so no partition is ever owned
 * by two members mid-rebalance. A member with nothing revoked is omitted entirely
 * rather than mapped to `[]` — the coordinator uses key presence to decide who
 * needs a revoke round at all.
 */
export function revocationsFor(previous: Assignment, next: Assignment): Assignment {
  const result: Assignment = {}
  for (const memberId of Object.keys(previous)) {
    const nextKeys = new Set((next[memberId] ?? []).map(partitionKey))
    const revoked = previous[memberId]!.filter((p) => !nextKeys.has(partitionKey(p)))
    if (revoked.length > 0) result[memberId] = revoked
  }
  return result
}
