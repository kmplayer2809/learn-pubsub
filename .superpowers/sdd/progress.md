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

Task 9: complete (commits 136f78d..3b6eb73, 80 tests, engine finished). Controller reviewed directly. Two plan defects found, neither caught by the 78-test suite because every existing test called advanceTo once from 0:
  - CRITICAL: run() popped every event up to the target time in one batch, so follow-ups scheduled during the batch were applied after later events already in the heap. Journal ran backwards ("0:publish | 2000:consumerCrash | 600:route") and the message was never delivered. Play advances per frame, scrub does one jump, so scrubbing produced a different simulation than playing. Fixed: run() drains exactly one timestamp per iteration via peekTime.
  - IMPORTANT: unacked stored ids only, but applyDispatch removes the message from its queue, so unacked was the only surviving copy. enrich() rebuilt held messages as blank placeholders; a crash "recovered" body:"" routingKey:"". Fixed: unacked is Record<NodeId, Message[]>.
  Both fixed in plan (272275b) before the code fix (2fad298), plus an injectable maxEvents ceiling (3b6eb73) that cut the runaway-guard test from 2954ms to 7ms — it was 87% of total suite runtime.
  Verified independently by the controller with a 3-publish crash+recover topology scrubbed to 4 targets; payloads preserved verbatim, journal monotonic.
  RESOLVED: the non-zero-TTL dead-letter cycle guard now has a real test and fires. RESOLVED: pushAll has two dedicated tests. Dangling-destination validation confirmed present in validateTopology.

Task 10: complete (commits 13fa291..570508a, 89 tests). Lesson schema, registry, hello-world lesson. Controller reviewed directly: brief matched the engine types with no cast-to-compile; golden-journal snapshot has real monotonic content (26 lines) and is backed by explicit count/ordering assertions, not snapshot-only. Implementer added a 6th test beyond the brief on its own initiative — accepted.
  Controller added schema guards (570508a) because Lessons 2-17 arrive from three separate subagents: duplicate ids, empty/out-of-order narratives, unknown groups, checkpoint answerIndex out of range. Probed: a duplicated lesson with reversed narrative fails both new guards.
  Schema note for Tasks 15-17: Lesson folds the design spec's separate `consumers` and `highlights` arrays into `topology.consumers` and `NarrativeStep.highlight`. Adds summary, seed, durationMs.

Task 11: complete (commits 60ae95c..cef1e2b, 100 tests). Zustand store + rAF binding.
  Implementer shipped useSimulation.ts (119 lines, all the app's impurity: rAF, performance.now, the rewind path) with ZERO tests, verified only by typecheck and code inspection. Controller rejected that and dispatched a dedicated test pass. Six behaviours now covered, each fail-checked by breaking its guard and confirming the test caught it: pause freezes, speed multiplier is numerically exact (100ms frame at 2x = 200ms virtual), halted stops the loop, end-of-lesson pauses, rewind replays to an identical journal, lesson switch resets clean.
  The rewind test asserts the intermediate state actually moved backwards (shorter journal, now <= seek target) BEFORE comparing journals — without that, a seek that silently no-ops would pass, because advanceTo ignores a target at or before its current time.
  No defects found in the hook itself.

Task 12: complete (commits 4bed197..a9ba331, 106 tests). React Flow canvas + four node types.
  No two-zustand-instance symptoms: only src/sim/store.ts imports bare 'zustand', all consumers import useAppStore from src/sim/store.
  Implementer verified node-position referential stability with a throwaway test and DELETED it. Controller made it permanent, plus a second invariant: every edgeId the engine puts inFlight must exist in toFlowEdges output, run across every registered lesson. Both probed red by cloning the position object and by dropping the publisher-edge rule.
  Why these matter: positions come from topology specs whose reference never changes within a Simulation, so stability holds today by construction — but nothing enforced it, and Task 13 reads edge geometry from React Flow. toFlowEdges derives publisher->exchange edges heuristically (publisher connects to each exchange having at least one binding), so a future lesson publishing to an unbound exchange would animate over an undrawn edge.

## Open notes (carry to final review)
- Minor: two zustand versions installed — top-level zustand@5 plus zustand@4.5.7 nested under @xyflow/react@12. Two instances in one tree can cause state-sharing bugs. Watch during Task 11 (store) and Task 12 (canvas).
- Root tsconfig.json is references-only. Bare `tsc --noEmit` is a silent no-op; use `npm run typecheck` (tsc -b).
- Reviewer flagged the implementer's "documented fallback" claim as false attribution. Adjudicated: NOT a defect — the temp-subdir fallback was in the controller's dispatch prompt, which the reviewer could not see.
- Task 9 added SimulationOptions.maxEvents. The Sandbox (Task 18) should expose or preset it so a user-built runaway topology halts fast instead of grinding to 200_000 events.
- 'retryBackoff' is wired to a no-op reducer in src/engine/index.ts REDUCERS. Nothing schedules it today (Lesson 13 uses TTL delay queues instead). If a later task schedules one it will vanish silently — make it throw, or delete the event type, at final review.
- useSimulation has no seam to inject a runaway topology (no maxEvents passthrough), so the halted-stops-loop test mocks createSimulation. Task 18's Sandbox needs that seam anyway — add it there and consider retargeting the test at the real engine.
- openSandbox() sets a `sandbox` flag but useSimulation only reads lessonId and ignores it, so opening the Sandbox would keep simulating the last lesson. Not a bug yet (no Sandbox UI until Task 18) — Task 18 must handle it.
- Minor (Task 12): oxlint Fast Refresh warning on src/ui/CanvasView/nodes.tsx for exporting `nodeTypes` beside components. Inherent to the planned file structure; left as-is.
