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

Task 13: complete (commits 37ba2fa..286c76d, 114 tests). SVG message particle overlay.
  Controller review found a defect: MessageLayer's viewport-transform effect was keyed on `state` alone, so pan/zoom (which changes React Flow's transform without producing a new EngineState) left the overlay painting with a stale transform and the particles detached from their edges. Worst while PAUSED - no new state at all - which is exactly when a user pans in to inspect. Fixed with a MutationObserver on the viewport element's style attribute (chosen over adding ReactFlowProvider + useViewport to keep the sibling-DOM architecture); particle positioning also promoted to useLayoutEffect, removing a one-frame lag and an extra render per animation frame.
  Controller probed a follow-on worry - the observer effect queries .react-flow__viewport once on mount and returns early if absent, where the old code re-queried every tick and self-healed. Empirically the element IS present at MessageLayer mount, so the single query is safe. Not a defect.

Task 14: complete (commits d3c9f35..32954c2, 123 tests, build 400KB/127KB gzip). Sidebar, transport, inspector, app wiring. App is usable end to end for lesson 01.
  Controller verified in a real browser, not just by report: scrubbing the slider from 0 to 1500ms moves the particle monotonically along the p1->default edge (cx 124.7 -> 135.8 -> 157.8 -> 190.9 -> 223.9 -> 246.0 -> 421.5 -> 628.5), and the measurement loop begins with a backwards seek from 1500 to 0, so rewind-replay and particle repositioning are both confirmed live.
  Scrub wiring correct: tickTo appears nowhere in src/ui; both the slider and Restart go through seek(), which is what bumps replayToken and forces the replay.
  Found and fixed a visible defect the tests could not see: the Markdown component supported **bold** and `code` only, so lesson 01's "*default exchange*" rendered with literal asterisks in the inspector. Fixed the renderer (not the lesson copy) since sixteen more hand-written narratives arrive in Tasks 15-17, plus a guard that no lesson narrative leaves an unrendered * or ` in its output. Probed red against the old renderer, and confirmed live in the browser afterwards (em = "default exchange", no stray asterisk).
  Added src/test/setup.ts with ResizeObserver/DOMMatrixReadOnly stubs wired via vitest setupFiles, which is what finally allows tests to mount the real React Flow tree.

Task 15: complete (commits 8d4b706..51ae1a8, 156 tests). Basics lessons 02-06 as pure data; no engine or component change was needed for the lessons themselves.
  Controller found that the Task 14 marker guard had started distorting the product: it counted asterisks inside rendered <code> spans as unrendered markers, so lesson 04 - the lesson whose subject IS * versus # - had been reworded to say "the single-word wildcard" rather than write `order.eu.*`. Guard now exempts code spans and lesson 04 writes the real patterns again. A test that forces the product to work around it is a broken test, not a satisfied constraint.
  Second defect found in the browser, not by tests: narrative step titles were dropped into an <h2> as raw text, so "`#` matches zero or more words" showed literal backticks. Added MarkdownInline (inline constructs, no <p> wrapper since an h2 cannot contain one) and extended the marker guard to cover titles as well as bodies. Verified live: h2 now renders * and # inside <code>.
  Note for Tasks 16-17: narrative titles AND bodies both render markdown now, and both are guarded.

## Open notes (carry to final review)
- Minor: two zustand versions installed — top-level zustand@5 plus zustand@4.5.7 nested under @xyflow/react@12. Two instances in one tree can cause state-sharing bugs. Watch during Task 11 (store) and Task 12 (canvas).
- Root tsconfig.json is references-only. Bare `tsc --noEmit` is a silent no-op; use `npm run typecheck` (tsc -b).
- Reviewer flagged the implementer's "documented fallback" claim as false attribution. Adjudicated: NOT a defect — the temp-subdir fallback was in the controller's dispatch prompt, which the reviewer could not see.
- Task 9 added SimulationOptions.maxEvents. The Sandbox (Task 18) should expose or preset it so a user-built runaway topology halts fast instead of grinding to 200_000 events.
- 'retryBackoff' is wired to a no-op reducer in src/engine/index.ts REDUCERS. Nothing schedules it today (Lesson 13 uses TTL delay queues instead). If a later task schedules one it will vanish silently — make it throw, or delete the event type, at final review.
- useSimulation has no seam to inject a runaway topology (no maxEvents passthrough), so the halted-stops-loop test mocks createSimulation. Task 18's Sandbox needs that seam anyway — add it there and consider retargeting the test at the real engine.
- openSandbox() sets a `sandbox` flag but useSimulation only reads lessonId and ignores it, so opening the Sandbox would keep simulating the last lesson. Not a bug yet (no Sandbox UI until Task 18) — Task 18 must handle it.
- Minor (Task 12): oxlint Fast Refresh warning on src/ui/CanvasView/nodes.tsx for exporting `nodeTypes` beside components. Inherent to the planned file structure; left as-is.
- No test renders the real CanvasView/ReactFlow tree. jsdom lacks ResizeObserver and DOMMatrixReadOnly, both of which @xyflow/react needs at mount; stubs are required. Task 14's app smoke test will hit this - stub them in a shared test setup rather than per-file.
