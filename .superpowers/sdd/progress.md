# Progress ledger — RabbitMQ visualizer

Plan: docs/superpowers/plans/2026-08-05-rabbitmq-visualizer.md
Branch: feat/rabbitmq-visualizer

Task 1: complete (commits eaf3421..998cea1, review clean after fix pass)

Task 2: complete (commits fbb7f2a..8606f77, review clean after fix pass — purity guard widened to 14 patterns, tsconfig.test.json isolates node types)

Task 3: complete (commit b7adf38, review clean, heap fuzzed at depth with ties)

Task 4: complete (commits d57a53f..96aabee, review clean after fix pass — headers vacuous-match bug was a plan defect, corrected in plan too)

Task 5: complete (commit 3dc337a, review clean — deep-freeze and seq-distinctness verified)

Task 6: complete (commits 9eb9664..cd00312, review found Critical round-robin starvation + Important autoAck reject; both were plan defects, fixed in code and plan)

Task 7: complete (commits 3c6732b..00b1728, review found Important stale-TTL cross-instance kill; plan defect, fixed in code and plan)

Task 8: complete (commits 8e5c141..5520f49, 62 tests). Controller ran the review directly (reviewer subagent was stopped). Found Important defect: both requeue paths (applyNack from Task 6, applyConsumerCrash from Task 8) prepended unconditionally, so a nacked priority-0 message jumped ahead of waiting priority-9 messages — one nack defeats a priority queue. Plan defect: Task 8 added insertByPriority but only wired it into applyEnqueue. Fixed via requeueByPriority in code and plan (d384bae).
  Adjudicated NOT a defect: drop-head overflow on a priority queue discards the highest-priority message. RabbitMQ documents exactly this ("higher priority messages might be dropped to make way for lower priority ones") — https://www.rabbitmq.com/docs/priority. Plan now marks it intentional; Lesson 15 teaches the gotcha. Do not "fix" it in a later task.

## Open notes (carry to final review)
- Minor: two zustand versions installed — top-level zustand@5 plus zustand@4.5.7 nested under @xyflow/react@12. Two instances in one tree can cause state-sharing bugs. Watch during Task 11 (store) and Task 12 (canvas).
- Root tsconfig.json is references-only. Bare `tsc --noEmit` is a silent no-op; use `npm run typecheck` (tsc -b).
- Reviewer flagged the implementer's "documented fallback" claim as false attribution. Adjudicated: NOT a defect — the temp-subdir fallback was in the controller's dispatch prompt, which the reviewer could not see.
- RESOLVED into Task 9 (commit 9e65f31): pushAll unit tests are now Task 9 Step 7.
- Minor (Task 5): applyEnqueue creates a phantom queue entry for a dangling binding destinationId instead of failing loudly. Task 9 validateTopology rejects dangling destinations pre-run, so this is covered defensively — confirm during Task 9 review.
- RESOLVED into Task 9 (commit 9e65f31): the non-zero-TTL dead-letter cycle guard now has a mandatory empirical test in Task 9 Step 7 asserting state.halted contains "event ceiling". Confirm it actually fired at Task 9 review.
