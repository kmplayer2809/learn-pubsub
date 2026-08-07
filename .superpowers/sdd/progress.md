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

## Scope change 2026-08-06 — Vietnamese copy

User asked for all reader-facing copy in Vietnamese with RabbitMQ/programming terms left
in English. Added as a Global Constraint in the plan (commit f729f22) plus a new
**Task 15b** (localize lessons 1-6 + UI chrome, add `src/lessons/language.test.ts` guard),
which runs before Task 16. Tasks 16, 17, 18, 19, 20 must author their copy in Vietnamese
from the start; their briefs carry the constraint block. Task 19's exported amqplib/NestJS
code is CODE — it stays English apart from any comment strings.

Task 15b: complete (commits f729f22..2fa6d5f, review clean after one fix wave).
  163 tests / 22 files. Guard `src/lessons/language.test.ts` is now the gate every
  lesson task must pass. Controller-verified red probes: an English checkpoint option
  fails on ENGLISH_FUNCTION_WORDS; an ASCII-only narrative body fails on the per-body
  VIETNAMESE check (the joined-blob check alone would have let it through).
  Adjudicated: lesson-level `title` stays English by design, exempted in Global
  Constraints at 5056db5 — do NOT "fix" it in a later task.
  Minor carried forward: the fix agent left loanwords route/drop/bind/broker/buffer/
  pattern in Vietnamese prose deliberately. Confirm at final review that this reads
  consistently across all 17 lessons.

Task 16: PARTIAL (commit 9881e26). Lessons 07, 08, 09, 11, 12, 13 shipped and green,
  205 tests / 23 files. **Lesson 10 (durability & confirms) NOT built** — reported
  BLOCKED: `seedEvents` in src/engine/index.ts never threads a `persistent` field from
  ScriptedAction into Message.persistent (every message is persistent:false), no UI
  renders a persistent chip, and no publisher-confirm event type exists in SimEventType.
  Needs an engine + UI task before the lesson can be written. Tracked as Task 16c (to be
  written).

Task 16b: OPEN — crash-cancels-processing bug, plan committed at 373db56.
  Controller-measured on lesson 07 at 9881e26: consumer `manual` acks [m1, m1, m2, m3, m4]
  while `auto` acks [m1, m2, m3, m4]; metrics published 4 / delivered 9 / acked 9. The
  stale `consumeDone` scheduled before a crash still fires and acks work that never
  finished. reliability.test.ts's `manualAcks > autoAcks` was passing 5>4 ON THE DUPLICATE.
  Fix is a per-consumer `crashEpoch` stamped at dispatch and compared in applyConsumeDone.

Task 15c: OPEN — dark React Flow chrome, message-id labels on particles, live in-flight
  panel. Plan committed at d2d3bd3. Requires widening `InFlight` to carry the whole
  `Message` (same defect class as `unacked`: an in-flight message is in no queue and not
  yet in unacked, so the record is the only copy). Must run AFTER 16b — both touch engine.

Task 16b: complete (commit a0f47a1). 207 tests / 23 files. Controller re-measured
  lesson 07 after the fix: manual [m1,m2,m3,m4] (4 unique, no duplicate), auto
  [m2,m3,m4] (m1 correctly lost to the crash), acked 7 / delivered 9. Bug gone.
  Agent caught a defect in MY brief: the pseudocode crashed at t=500, which does not
  interrupt processing here (delivery lands ~t=1800 after TRAVEL_MS pipeline delays),
  so that test would have passed trivially against the buggy code. It recomputed the
  window to t=2000 and showed both tests red first. Also fixed EngineState literals in
  src/sim/useSimulation.test.tsx and src/ui/canvas/MessageLayer.test.tsx (crashEpoch: {})
  — outside the stated scope but required to keep typecheck green; correct call.

  OPEN QUESTION for final review (modeling divergence, not a bug): this engine acks an
  auto-ack message at `consumeDone`, not at delivery, so a crashed auto-ack consumer
  produces NO ack at all. Real RabbitMQ acks on delivery, so `acked` would still count
  the lost message. Lesson 07's narrative says "broker đã coi message là xác nhận xong
  ngay khi giao", which is true of RabbitMQ but not of what the metrics panel shows.
  The pedagogical point (auto-ack loses work silently, manual recovers it) survives
  either way. Decide at final review whether to move the auto-ack to delivery time or
  to reword the narrative.

Task 15c: complete (commits a0f47a1..9034354). 213 tests / 24 files.
  Agent caught a defect in MY brief: the CSS override as written lost the cascade.
  CanvasView.tsx imports @xyflow/react/dist/style.css beneath App, Vite emits it AFTER
  index.css, same specificity — so React Flow's own rule won and the strip stayed white.
  Only visible in a running browser. Fixed with !important plus a comment saying why.
  Controller browser-verified afterwards and found two MORE light-chrome leaks the task
  missed: `.react-flow__edge-textbg` was pure white with black text (the binding routing
  key chips — brightest thing on the canvas, on every lesson that binds with a key) and
  `.react-flow__handle` was ringed in pure white. Fixed at 9034354.
  LESSON: the CSS override block must be verified with getComputedStyle in a live page,
  never by reading the stylesheet. Do the same for any future React Flow chrome.

Task 16c: OPEN — persistence, publisher confirms, lesson 10. Plan written at ca30a59.
  Unblocks the Lesson 10 that Task 16 reported BLOCKED. Three engine gaps to close:
  ScriptedAction has no `persistent`, QueueSpec has no `durable`, SimEventType has no
  `confirm`. Model decided in the plan: schedule the confirm from applyRoute, NOT from
  applyEnqueue — route is the only point that knows the full destination set, so a fanout
  to three queues still yields exactly one confirm and an unroutable message is still
  confirmed, both faithful to RabbitMQ. The slow CONFIRM_PERSISTENT_MS path applies only
  when the message is `persistent` AND a destination queue is `durable` (durability is
  per-pair). Metrics.confirmed needs no UI work — Inspector.tsx renders metrics with
  Object.entries, so a new counter appears by itself.

Task 17: code COMPLETE (commit 58cf9f9), REVIEW STILL OWED — the task reviewer was never
  dispatched because the user paused. 241 tests / 25 files, typecheck clean; controller
  re-ran both independently rather than trusting the report. All four brief-estimated
  counts (acked 6, 3, 12; m4 before m3) measured correct — no assertion was changed.

  *** REGRESSION FOUND BY THE CONTROLLER, MUST BE FIXED FIRST ON RESUME ***
  The agent extended src/ui/CanvasView/toFlow.ts beyond its stated scope, adding a
  consumer x exchange cross-product edge loop mirroring the existing publisher one. It
  keeps a canvas invariant test green, but it fabricates edges on EVERY lesson, and it
  draws them with `dashed = true` — which in this codebase is the DEAD-LETTER styling.
  Measured spurious consumer->exchange edges (controller ran toFlowEdges over all LESSONS):
    01:1/4  02:3/10  03:3/10  04:3/10  05:3/10  06:3/8  07:2/7  08:3/9  09:1/4
    11:4/11  12:2/8  13:4/13  14:4/10  15:1/4  16:2/8  17:2/7
  Worst case 11-dlx: 4 of 11 edges are fake, all rose-dashed, on the lesson whose entire
  subject is dead-lettering — the lesson now draws three fake DLX arrows next to its one
  real one. Even on 14-rpc, the lesson that motivated the change, only `worker->replies`
  is real; `worker->rpc-ex`, `caller->rpc-ex` and `caller->replies` are invented.
  FIX DIRECTION: a reply edge is knowable from the script, not the topology — the script
  declares `replyTo`. Pass the script (or just the set of exchange ids appearing as a
  `replyTo`) into toFlowEdges and emit a consumer->exchange edge only for those. That is
  1 edge on 14-rpc and 0 everywhere else. Do NOT keep the cross-product.
  LESSON (same shape as Task 15c): a green suite says nothing about what the canvas looks
  like. Verify canvas changes by measuring the derived edge set, not by reading the diff.

Task 17 dispatch notes: Pattern lessons 14-17 (RPC, priority,
  delayed message, quorum vs classic). Controller verified BEFORE dispatch that the engine
  genuinely supports all of it — insertByPriority is called from broker.ts, buildReplyEvents
  and requeueByPriority from delivery.ts, QueueKind exists, and seedEvents already threads
  priority/correlationId/replyTo. So this task has no 16c-style gap.
  WARNED THE AGENT: the expected counts in the plan's test code (acked 6 for RPC, 3 for
  delayed, 12 for quorum) are the controller's estimates from READING the engine, never
  measured. TRAVEL_MS pipeline delays make the timeline non-obvious. Agent instructed to
  measure the journal first, fix the number and show evidence if the engine is right, and
  report BLOCKED rather than loosen any assertion to green.

toFlow regression: FIXED (commit 0414e1d). 258 tests / 25 files, typecheck clean.
  Controller fixed inline rather than dispatching — full context already held, and the
  fix was precisely specified. Reply edges now derive from the script's `replyTo`: for
  each action carrying one, find the queues bound to the exchange it was published to and
  draw an edge from the consumers on those queues to the `replyTo` exchange. Yields
  exactly `worker->replies` on 14-rpc and nothing anywhere else. Styling reverted from
  the dead-letter dash to the ordinary solid stroke — a reply is a real publish path.
  `toFlowEdges(topology, script = [])`; CanvasView takes an optional `script` prop, App
  passes `lesson.script`.
  ROOT CAUSE worth remembering: the pre-existing invariant test was ONE-DIRECTIONAL. It
  asserted every travelled edge is drawn, so it stayed green no matter how many edges
  were invented, and the cross-product satisfied it trivially. Added the other direction
  (every consumer->exchange edge drawn must be travelled) plus an explicit 14-rpc case.
  RED-PROBED both: restoring the cross-product turns the new test red on 16 of 16 lessons.

Task 16c: complete (commits 43411eb..5edea33). 288 tests / 26 files, typecheck clean.
  Lesson 10 now ships, so all 17 lessons exist. Engine gained QueueSpec.durable,
  ScriptedAction.persistent, SimEventType 'confirm', Metrics.confirmed. Metrics needed no
  UI work as predicted (Inspector renders Object.entries). Transient messages now draw
  hollow on the canvas, so lesson 10's odd-one-out is visible at a glance.

  CONTROLLER-FOUND BUG, fixed at 5edea33. The agent scoped confirms to "fromId is a
  publisher id" to stop an exchange-to-exchange fan-out double-confirming. Measured
  published vs confirmed across all 17 lessons and 14-rpc was the lone disagreement:
  published 6 / confirmed 3. RPC replies are published by a CONSUMER (buildReplyEvents
  uses the consumer's node id), so they were never confirmed — and the metrics panel
  showed that contradiction right next to lesson 10, which teaches that a confirm answers
  every publish.
  MY FIRST FIX WAS WRONG and the new test caught it in one run: relaxing to "not an
  exchange" let dead-letter republishes through, since those carry the QUEUE as fromId.
  13-retry-backoff went to 56 confirms against 4 publishes. Correct predicate is publisher
  OR consumer — those are the clients; exchanges and queues are the broker moving a
  message it already owns.
  Added `%s confirms every publish` over all LESSONS in lessons.test.ts. RED-PROBED:
  restoring the publisher-only predicate turns 14-rpc red.
  NOTE for the final review: the agent's e2e-binding concern is real but unexercised —
  no shipped lesson uses `destinationKind: 'exchange'` (verified by grep), so the
  double-confirm guard has no test. Worth one if a lesson ever adds an e2e binding.

Task 17 review: the formal task reviewer was never dispatched (the pause landed on it).
  The controller reviewed it directly instead and found the toFlow regression above. The
  final whole-branch review still needs to cover 58cf9f9 properly.

Task 18: code complete (commit 46c2d69). 295 tests / 27 files, typecheck clean.
  Sandbox ships: add/delete nodes, drag to connect, node config, publish form, generator,
  localStorage save/reset. Controller drove the running app rather than reading the report
  and confirmed the shell works — all 17 lessons plus a Sandbox button in the sidebar, the
  four add-node buttons create wired nodes, the node config panel edits and deletes, the
  publish form correctly refuses to enable before a publisher exists.
  MY BRIEF WAS WRONG, not the agent: I told it not to add localStorage persistence, but
  the plan's own Task 18 specifies `save`/`load` under STORAGE_KEY including a malformed-
  payload test. The agent followed the brief file, which is correct. Do not "fix" this.

  TWO DEFECTS FOUND IN THE BROWSER, fix dispatched:
  1. The Sandbox renders engine ValidationIssue.message verbatim, so its only feedback
     channel is English: `warning: queue queue-3 has no binding, so no message can reach
     it`. Invisible in lessons because every shipped lesson is valid; in the Sandbox an
     invalid topology is the normal mid-edit state, so this is the primary guidance a
     learner gets and the one part of the UI still in English. Engine must stay English
     (its tests assert these strings), so the fix adds a `code` to ValidationIssue and
     renders Vietnamese from it in the UI. Seven issue shapes in validate.ts.
  2. Every `.react-flow__handle` measures 6x6 CSS px in the live page, and dragging
     between handles is the ONLY way to create a binding — selecting an exchange offers a
     type selector and delete, nothing else. The panel says `kéo để connect` and gives a
     six-pixel target for it.
  UNVERIFIED BY ME: whether drag-to-connect actually works. React Flow uses D3-drag and
  ignored synthetic PointerEvents, so I could not exercise the path; the agent reports
  testing it by hand. The fix agent was told to confirm it and report BLOCKED if broken.
  Also carried forward from the agent's own report: it found that a message published
  under a publisherId that is not a real topology node gets no confirm, and worked around
  it in the UI by requiring a real publisher. That is a consequence of the 5edea33
  predicate (publisher OR consumer). Sandbox-only, and the lesson-wide
  `confirms every publish` invariant does not cover sandbox topologies.
  Agent also flagged that the runaway guard cannot be tripped by normal Play/Scrub, since
  each routing hop costs a fixed 600ms of virtual time. Not a bug — it also means a
  hand-built loop cannot freeze the tab in reachable time — but worth a look at Task 20.

Task 18 fix wave 1: complete (commit bf97364). 301 tests / 28 files, typecheck clean.
  Both defects verified live by the controller, not taken on report:
  - Vietnamese issue copy works. ValidationIssue gained a `code` + params; `message` stays
    English for the engine's tests; `src/ui/Inspector/issueText.ts` renders Vietnamese via
    an exhaustive switch, wired into the shared IssuesList used by BOTH Inspector and
    SandboxPanel, so there is only one implementation. Measured: `cảnh báo: queue queue-3
    chưa có binding nào, nên không message nào tới được`.
  - Handle hit area measured 20x20 CSS px by elementFromPoint grid scan (400 of 625 probe
    points reach the handle). Drag-to-connect confirmed working end to end: exchange-6
    source -> queue-7 target created the edge and cleared the warning.
  Answer to the open question from before: React Flow's Handle listens on onMouseDown, not
  pointer events. That is why my synthetic PointerEvents did nothing. MouseEvents work.

  FALSE ALARM I RAISED AND RETRACTED, recorded so nobody re-investigates it: I first
  measured 5 of 6 handles as having ZERO grabbable pixels and traced the blocker to
  another node's card painting over them. The cause was my own test method — I clicked all
  four add-node buttons synchronously in one evaluate_script, React batched the updates, so
  `nextPosition(topology)` read count=0 four times and stacked every node at
  translate(80px,60px). With realistic delays between clicks the nodes lay out correctly at
  80/260/440/620 and every handle is reachable. `nextPosition` in SandboxPanel.tsx is
  correct. Do not "fix" it.

Task 18 fix wave 2: DISPATCHED. Three defects found by using the Sandbox as a first-time
  user would, all of which the passing suite and both prior agents missed:
  1. CRITICAL — SandboxPanel replaces Inspector wholesale, and renders NEITHER the metrics
     grid NOR the event log. The one mode built for experimenting is the only mode that
     shows nothing about what the broker did. Fix must reuse Inspector's rendering, not
     fork it.
  2. CanvasView.handleConnect calls `addBinding(source, target, '')` and nothing can ever
     edit that routing key — SandboxPanel's `routingKey` state belongs to the publish form,
     there is no binding editor, and edges are not clickable. On a `direct` exchange the
     only key that can match is the empty string.
  3. Publishing while the virtual clock is already past the new action's `at` does nothing
     and looks identical to success.
  Compound effect, which is how I hit it: published with key `demo`, message was dropped at
  the exchange for a key mismatch, and with no metrics and no log the entire UI stayed
  silent. Nothing on screen could explain it.

Task 18 fix wave 2: complete (commit 4e87ed3). 309 tests / 29 files, typecheck clean.
  Controller re-walked the whole first-time-user path in the browser. Confirmed working:
  metrics grid and event log now render in SandboxPanel (reusing Inspector's, not a fork);
  an exchange's config panel lists its bindings with an editable routing key and a delete;
  setting the key to `demo` immediately shows `demo` as the edge label on the canvas.
  Measured end to end: published 1 / routed 1 / dropped 0 / delivered 1 / acked 1 /
  confirmed 1, with the log reading publish -> route -> confirm -> enqueue -> receive ->
  ack. Engine log text stays English by design; that is correct.
  MY DEFECT 3 WAS NOT REAL and the agent was right to push back. The sandbox already
  schedules a publish relative to current virtual time (measured: published at 46.7s while
  the clock was already there) and rebuilds on every change, so nothing is ever dropped for
  being late. The silence I originally hit was defect 2 plus defect 1: a routing-key
  mismatch dropped the message and nothing on screen could say so. Do not revisit.
  Note on automating this UI: the Publish button is correctly `disabled` until an exchange
  is chosen, and several of my earlier "publish does nothing" readings were that guard
  working. Check `btn.disabled` before concluding anything from a synthetic click.

Task 19: complete (commit d4a3d04). 322 tests / 30 files, typecheck clean.
  Code export ships (src/sandbox/export/: amqplib.ts, nestjs.ts, queueArguments.ts).
  Controller verified the thing that actually matters — that no non-default topology field
  is silently dropped — by generating for all 17 lessons and asserting every set
  messageTtlMs / maxLength / deadLetterExchange / deadLetterRoutingKey / maxPriority /
  quorum kind / durable appears with its value in the output. Zero misses. Read the
  13-retry-backoff output directly: correct amqplib API (assertExchange, assertQueue with
  an `arguments` object, bindQueue, prefetch, consume with noAck), TTL and both dead-letter
  args present and correct.
  Browser-checked: `Xuất code` button, amqplib/NestJS tabs, `Sao chép`, code legible at
  panel width, no horizontal page scroll.
  Agent extended scope deliberately and correctly: wired Export into Inspector (lesson
  mode) as well as SandboxPanel, sharing one ExportDialog rather than forking, because the
  task framing says "the topology the user is looking at".
  IT ALSO FIXED FOUR REAL BUGS IN MY BRIEF'S SAMPLE CODE, which I had written and would
  have shipped: hardcoded `durable: true` ignoring QueueSpec.durable; `channel.nack` called
  on auto-ack messages, which throws at runtime; NestJS `queueOptions.arguments` left as a
  dead placeholder; and `pascal()` emitting identifiers containing spaces for prose
  consumer labels like "Parking-lot inspector".
  Minor, not worth a wave: `arguments: {}` is emitted even for queues with no arguments.
  Open: the agent could not get a clipboard readback in the automated browser session, so
  the copy button's actual write is unconfirmed. Worth one manual click at Task 20.

=== PAUSED 2026-08-06 23:30 (+07) at the user's request; resumed 03:34 on 2026-08-07. ===
  ON RESUME, do NOT re-dispatch anything marked complete above. Order of remaining work:
  finish Task 17's review loop (read .superpowers/sdd/task-17-report.md and `git log` to
  see whether the agent committed before the pause — trust git over recollection), then
  16c, 18 (sandbox), 19 (code export), 20 (final pass + README), then the whole-branch
  review and superpowers:finishing-a-development-branch.
  If the Task 17 completion notification arrives DURING the pause, record its result in
  this ledger and stop there. The user asked to pause; do not roll on into Task 16c.

Task 20: complete (commit 342db9c). Final pass + README.
  Controller executed this inline, not via subagent: the dispatched agent died on a
  session limit AFTER writing files but BEFORE committing, so the working tree already
  held its items 1-4. Verified each rather than trusting it.
  1. Auto-ack divergence: measured lesson 07 directly — delivered 9 / acked 7; the auto
     consumer takes 4 deliveries but only 3 acks because m1 is lost at the 2000ms crash.
     Agent's narrative rewording is accurate. BUT it left the engine's own journal line
     saying "in-flight message lost because auto-ack already confirmed it", which
     contradicts both the corrected narrative and the acked counter beside it. Also false
     when the consumer is idle: nothing in state tracks whether an auto-ack consumer was
     mid-processing, so that branch fires on every auto-ack crash. Controller reworded it.
  2. Loanword pass: grep for hàng đợi / định tuyến / thông điệp / người tiêu thụ /
     nhà xuất bản / bộ đệm across non-test src is now empty.
  3. oxlint Fast Refresh warning gone — `npm run lint` is silent.
  4. `arguments: {}` no longer emitted; confirmed by reading the live export output.
  5. Copy button VERIFIED (was the open item from Task 19). Stubbed writeText and clicked
     the real button: passes 661 chars matching the <pre> exactly, label goes
     "Sao chép đoạn code này" -> "Đã sao chép" -> back after 1.5s. Found and fixed a real
     defect while doing it — the catch was silent, so a rejected write (insecure context,
     e.g. plain HTTP on a LAN IP) left the button inert with no feedback. Now shows a
     failure label; both paths measured in the browser.
  6. README written. `npm run build` succeeds — 478.57 kB js / 30.10 kB css, first time a
     production build has been exercised. Controller corrected one wrong instruction in it:
     it said "Kéo thanh Sandbox" (drag) when the sidebar control is a click button.
     Its "322 test trên 30 file" claim checked and accurate.

REMAINING: final whole-branch review (still owes proper coverage of Task 17's 58cf9f9 —
that task's formal reviewer was never dispatched), then
superpowers:finishing-a-development-branch.
