# Shell Restyle (Color Tokens + Mobile Touch Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `slate-*`/`sky-*` Tailwind classes in the shell chrome with semantic `ink-*`/`accent-*` tokens (zero visual change, config-driven rebrand later), and fix the one mobile touch-spacing gap that falls below the 8px guideline.

**Architecture:** Add `ink`/`accent` color scales to `tailwind.config.js` that are byte-identical to the `slate`/`sky` shades already in use, then mechanically rename `slate-NNN` → `ink-NNN` and `sky-NNN` → `accent-NNN` (preserving opacity suffixes) file by file through the shell chrome only. Canvas node colors, checkpoint status colors, and `IssuesList`/`HaltedBanner` status colors are explicitly untouched. One real behavior change: `Transport.tsx` compact-mode button gap goes from `gap-1.5` (6px) to `gap-2` (8px).

**Tech Stack:** React, Tailwind CSS 3.4 (JIT), Vitest + Testing Library, TypeScript (`tsc -b`).

**Spec:** `docs/superpowers/specs/2026-09-05-shell-restyle-design.md`

## Global Constraints

- Token hex values MUST be byte-identical to Tailwind's stock `slate`/`sky` shades — this migration is a rename, not a recolor. Any pixel diff after a rename-only task is a bug in that task.
- Scale: `ink` = `{100:'#f1f5f9', 200:'#e2e8f0', 300:'#cbd5e1', 400:'#94a3b8', 500:'#64748b', 600:'#475569', 700:'#334155', 800:'#1e293b', 900:'#0f172a', 950:'#020617'}`. `accent` = `{100:'#e0f2fe', 300:'#7dd3fc', 400:'#38bdf8', 500:'#0ea5e9', 600:'#0284c7', 950:'#082f49'}`.
- **Never touch, in any task:** `src/brokers/*/ui/nodes.tsx`, `src/brokers/*/ui/NodeConfig.tsx`, `src/brokers/*/ui/*Panel.tsx`, `src/brokers/*/sandbox/**`, `CheckpointCard.tsx` — deliberate role/status color systems, out of spec scope. Inside `Inspector.tsx`, leave every `rose-*`/`amber-*` class alone (the `IssuesList`/`HaltedBanner` status colors) — only `slate-*` classes in that file are in scope.
- No CSS custom properties / runtime theme switching — this app is dark-only and none is planned. `theme.extend.colors` in `tailwind.config.js` is the only new indirection.
- Use `npm run typecheck` (never bare `npx tsc --noEmit` — see `CLAUDE.md`, it silently compiles zero files).
- Every task ends with `npm test` for at least the touched component's test file, and a final task runs the full suite.
- Commit after each task (already-established repo convention: small, focused commits).

---

### Task 1: Tailwind `ink`/`accent` color tokens

**Files:**
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: Tailwind utility classes `bg-ink-{100..950}`, `text-ink-{100..950}`, `border-ink-{100..950}`, `ring-ink-{100..950}` etc. (10 shades), and `bg-accent-{100,300,400,500,600,950}`, `text-accent-*`, `border-accent-*`, `ring-accent-*`, `shadow-accent-*` (6 shades) — plus any Tailwind opacity modifier on each (`ink-950/95`, `accent-500/10`, etc., which Tailwind generates automatically for any custom color). Every later task in this plan consumes these classes; none exist before this task runs.

- [ ] **Step 1: Read the current config**

Current `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 2: Add the two color scales**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Byte-identical to Tailwind's stock `slate`/`sky` shades already used
        // throughout the shell chrome — this is a rename for token indirection,
        // not a recolor. See docs/superpowers/specs/2026-09-05-shell-restyle-design.md.
        ink: {
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        accent: {
          100: '#e0f2fe',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          950: '#082f49',
        },
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Verify the build still works**

Run: `npm run build`
Expected: succeeds with no errors (no component references the new tokens yet, so this only proves the config is syntactically valid and doesn't break the existing build).

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.js
git commit -m "feat(ui): add ink/accent semantic color tokens to Tailwind config"
```

---

### Task 2: Migrate `TopBar.tsx`

**Files:**
- Modify: `src/shell/ui/TopBar/TopBar.tsx`
- Test: `src/shell/ui/TopBar/TopBar.test.tsx` (no changes needed — it asserts text content and click behavior, not class names; confirms this task is a pure rename)

**Interfaces:**
- Consumes: `ink-*`/`accent-*` tokens from Task 1.

- [ ] **Step 1: Rename classes**

```diff
     <header
-      className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 bg-slate-950/95 px-2 pt-safe backdrop-blur"
+      className="flex shrink-0 items-center gap-2 border-b border-ink-800/80 bg-ink-950/95 px-2 pt-safe backdrop-blur"
       data-testid="top-bar"
     >
       {onOpenDrawer && (
         <button
           onClick={onOpenDrawer}
           aria-label="Mở danh sách bài học"
-          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 active:bg-slate-700"
+          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-800 active:bg-ink-700"
         >
           <MenuIcon />
         </button>
       )}
       <BrokerSwitcher />
-      <span className="min-w-0 flex-1 truncate text-right text-xs font-medium text-slate-400">{title}</span>
+      <span className="min-w-0 flex-1 truncate text-right text-xs font-medium text-ink-400">{title}</span>
```

- [ ] **Step 2: Confirm no `slate-`/`sky-` left in this file**

Run: `grep -nE "slate-|sky-" src/shell/ui/TopBar/TopBar.tsx`
Expected: no output.

- [ ] **Step 3: Run the existing test file**

Run: `npx vitest run src/shell/ui/TopBar/TopBar.test.tsx`
Expected: PASS, all 3 tests, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ui/TopBar/TopBar.tsx
git commit -m "refactor(ui): migrate TopBar to ink/accent color tokens"
```

---

### Task 3: Migrate `MobileTabBar.tsx`

**Files:**
- Modify: `src/shell/ui/MobileTabBar/MobileTabBar.tsx`
- Test: `src/shell/ui/MobileTabBar/MobileTabBar.test.tsx` (no changes needed)

**Interfaces:**
- Consumes: `ink-*`/`accent-*` tokens from Task 1.

- [ ] **Step 1: Rename classes**

```diff
     <div
       role="tablist"
-      className="flex shrink-0 border-t border-slate-800/80 bg-slate-950/95 pb-safe backdrop-blur"
+      className="flex shrink-0 border-t border-ink-800/80 bg-ink-950/95 pb-safe backdrop-blur"
       data-testid="mobile-tabbar"
     >
       {TABS.map(({ id, label, Icon }) => (
         <button
           key={id}
           role="tab"
           aria-selected={pane === id}
           onClick={() => setPane(id)}
           className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 py-1 text-[11px] ${
             pane === id
-              ? 'border-sky-400 text-sky-300'
-              : 'border-transparent text-slate-500 active:bg-slate-900'
+              ? 'border-accent-400 text-accent-300'
+              : 'border-transparent text-ink-500 active:bg-ink-900'
           }`}
         >
-          <Icon className={`h-[18px] w-[18px] ${pane === id ? 'text-sky-300' : 'text-slate-500'}`} />
+          <Icon className={`h-[18px] w-[18px] ${pane === id ? 'text-accent-300' : 'text-ink-500'}`} />
           {label}
         </button>
       ))}
```

- [ ] **Step 2: Confirm no `slate-`/`sky-` left in this file**

Run: `grep -nE "slate-|sky-" src/shell/ui/MobileTabBar/MobileTabBar.tsx`
Expected: no output.

- [ ] **Step 3: Run the existing test file**

Run: `npx vitest run src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`
Expected: PASS, all 4 tests, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ui/MobileTabBar/MobileTabBar.tsx
git commit -m "refactor(ui): migrate MobileTabBar to ink/accent color tokens"
```

---

### Task 4: Migrate `LessonSidebar.tsx`

**Files:**
- Modify: `src/shell/ui/LessonSidebar/LessonSidebar.tsx`
- Test: `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx` (no changes needed)

**Interfaces:**
- Consumes: `ink-*`/`accent-*` tokens from Task 1.

- [ ] **Step 1: Rename classes**

```diff
-    <nav className="flex h-full flex-col overflow-y-auto bg-slate-950" data-testid="lesson-sidebar">
+    <nav className="flex h-full flex-col overflow-y-auto bg-ink-950" data-testid="lesson-sidebar">
       {!hideBrokerSwitcher && <BrokerSwitcher />}
       <div className="flex-1 py-2">
         {broker.lessonGroups.map((group) => (
           <div key={group.id} className="mb-2">
-            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
+            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
               {group.label}
             </div>
             {broker.lessons.filter((l) => l.group === group.id).map((lesson) => {
               const active = !sandbox && lesson.id === lessonId
               return (
                 <button
                   key={lesson.id}
                   onClick={() => setLesson(lesson.id)}
                   className={`block min-h-11 w-full border-l-2 px-3 py-1.5 text-left text-xs leading-snug md:min-h-0 ${
                     active
-                      ? 'border-sky-400 bg-sky-500/10 font-medium text-sky-300'
-                      : 'border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-200'
+                      ? 'border-accent-400 bg-accent-500/10 font-medium text-accent-300'
+                      : 'border-transparent text-ink-400 hover:border-ink-700 hover:bg-ink-900 hover:text-ink-200'
                   }`}
                 >
                   {lesson.title}
                 </button>
               )
             })}
           </div>
         ))}
       </div>
       {broker.sandbox && (
         <button
           onClick={openSandbox}
-          className={`min-h-11 shrink-0 border-t border-slate-800/80 px-3 py-2 text-left text-xs font-medium md:min-h-0 ${
-            sandbox ? 'bg-sky-500/10 text-sky-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
+          className={`min-h-11 shrink-0 border-t border-ink-800/80 px-3 py-2 text-left text-xs font-medium md:min-h-0 ${
+            sandbox ? 'bg-accent-500/10 text-accent-300' : 'text-ink-400 hover:bg-ink-900 hover:text-ink-200'
           }`}
           data-testid="open-sandbox"
         >
```

- [ ] **Step 2: Confirm no `slate-`/`sky-` left in this file**

Run: `grep -nE "slate-|sky-" src/shell/ui/LessonSidebar/LessonSidebar.tsx`
Expected: no output.

- [ ] **Step 3: Run the existing test file**

Run: `npx vitest run src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`
Expected: PASS, all 3 tests, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ui/LessonSidebar/LessonSidebar.tsx
git commit -m "refactor(ui): migrate LessonSidebar to ink/accent color tokens"
```

---

### Task 5: Migrate `BrokerSwitcher.tsx`

**Files:**
- Modify: `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`
- Test: `src/shell/ui/BrokerSwitcher/BrokerSwitcher.test.tsx` (no changes needed)

**Interfaces:**
- Consumes: `ink-*`/`accent-*` tokens from Task 1.

- [ ] **Step 1: Rename classes**

```diff
     <div
-      className="flex gap-1 border-b border-slate-800/80 p-2"
+      className="flex gap-1 border-b border-ink-800/80 p-2"
       aria-label="Chọn broker"
       data-testid="broker-switcher"
     >
       {BROKERS.map((broker) => (
         <button
           key={broker.id}
           aria-pressed={broker.id === brokerId}
           data-testid="broker-tab"
           data-broker-id={broker.id}
           onClick={() => setBroker(broker.id)}
           className={`min-h-11 flex-1 rounded-lg px-2 py-1 text-xs font-medium md:min-h-0 ${
             broker.id === brokerId
-              ? 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/40'
-              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
+              ? 'bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/40'
+              : 'text-ink-400 hover:bg-ink-800/60 hover:text-ink-200'
           }`}
         >
```

- [ ] **Step 2: Confirm no `slate-`/`sky-` left in this file**

Run: `grep -nE "slate-|sky-" src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`
Expected: no output.

- [ ] **Step 3: Run the existing test file**

Run: `npx vitest run src/shell/ui/BrokerSwitcher/BrokerSwitcher.test.tsx`
Expected: PASS, all 4 tests, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx
git commit -m "refactor(ui): migrate BrokerSwitcher to ink/accent color tokens"
```

---

### Task 6: Migrate `Transport.tsx` + fix compact touch-spacing

**Files:**
- Modify: `src/shell/ui/Transport/Transport.tsx`
- Test: `src/shell/ui/Transport/Transport.test.tsx` (add one new test)

**Interfaces:**
- Consumes: `ink-*`/`accent-*` tokens from Task 1.

This task has an actual behavior change (compact-mode button gap 6px → 8px), so it gets a real failing-first test, unlike the pure-rename tasks above.

- [ ] **Step 1: Write the failing test**

Add to `src/shell/ui/Transport/Transport.test.tsx`, inside the existing `describe('Transport', ...)` block:

```tsx
  it('chế độ compact dùng khoảng cách 8px giữa nút, không phải 6px', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    expect(screen.getByTestId('transport').className).toContain('gap-2')
    expect(screen.getByTestId('transport').className).not.toContain('gap-1.5')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shell/ui/Transport/Transport.test.tsx -t 'khoảng cách 8px'`
Expected: FAIL — current class is `gap-1.5` in compact mode.

- [ ] **Step 3: Rename classes and fix the gap**

```diff
   const max = durationMs + 5000
   const tap = compact ? 'min-h-11 min-w-11' : ''

   return (
     <div
-      className={`flex shrink-0 items-center border-t border-slate-800/80 bg-slate-950/95 px-3 py-2 ${compact ? 'gap-1.5' : 'gap-3'}`}
+      className={`flex shrink-0 items-center border-t border-ink-800/80 bg-ink-950/95 px-3 py-2 ${compact ? 'gap-2' : 'gap-3'}`}
       data-testid="transport"
     >
       <button
         onClick={() => seek(0)}
         aria-label="Chạy lại"
-        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 active:bg-slate-700 ${tap}`}
+        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 active:bg-ink-700 ${tap}`}
       >
         {compact ? <ReplayIcon /> : <><ReplayIcon className="h-4 w-4" /> Chạy lại</>}
       </button>
       <button
         onClick={() => (playing ? pause() : play())}
-        className={`flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-sky-950/50 hover:bg-sky-500 active:bg-sky-600 ${tap}`}
+        className={`flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-accent-950/50 hover:bg-accent-500 active:bg-accent-600 ${tap}`}
         data-testid="play-pause"
       >
         {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
         {!compact && (playing ? 'Tạm dừng' : 'Chạy')}
       </button>
       <button
         onClick={() => {
           pause()
           onStep()
         }}
         aria-label="Bước"
-        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 active:bg-slate-700 ${tap}`}
+        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 active:bg-ink-700 ${tap}`}
       >
         {compact ? <StepForwardIcon /> : <><StepForwardIcon className="h-4 w-4" /> Bước</>}
       </button>

       <input
         type="range"
         min={0}
         max={max}
         step={50}
         value={Math.min(virtualTime, max)}
         onChange={(e) => seek(Number(e.target.value))}
         className={`${compact ? 'min-w-0 ' : ''}flex-1`}
         aria-label="scrub"
       />
       <span
-        className={`${compact ? 'w-11' : 'w-16'} text-right font-mono text-[11px] text-slate-400${compact ? ' shrink-0' : ''}`}
+        className={`${compact ? 'w-11' : 'w-16'} text-right font-mono text-[11px] text-ink-400${compact ? ' shrink-0' : ''}`}
       >
         {(virtualTime / 1000).toFixed(1)}s
       </span>

       <select
         value={speed}
         onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
-        className={`rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700${compact ? ' shrink-0 min-h-11' : ''}`}
+        className={`rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-ink-200 hover:bg-ink-700${compact ? ' shrink-0 min-h-11' : ''}`}
         aria-label="speed"
       >
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/shell/ui/Transport/Transport.test.tsx`
Expected: PASS, all 5 tests (4 existing + 1 new).

- [ ] **Step 5: Confirm no `slate-`/`sky-` left in this file**

Run: `grep -nE "slate-|sky-" src/shell/ui/Transport/Transport.tsx`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/shell/ui/Transport/Transport.tsx src/shell/ui/Transport/Transport.test.tsx
git commit -m "fix(ui): widen Transport compact-mode button gap to 8px, migrate to ink/accent tokens"
```

---

### Task 7: Migrate `Inspector.tsx` (chrome only, status colors untouched)

**Files:**
- Modify: `src/shell/ui/Inspector/Inspector.tsx`
- Test: none dedicated — verified through `src/shell/ui/App.test.tsx` (renders `Inspector` and asserts on `export-button`, `inspector` testid)

**Interfaces:**
- Consumes: `ink-*` tokens from Task 1. No `accent-*` usage in this file.
- **Do not touch:** the `rose-*` classes in `IssuesList` (line ~36-39) and the `amber-*` classes in `HaltedBanner` (line ~52) — status-semantic colors, out of scope per spec.

- [ ] **Step 1: Rename classes**

```diff
 export function MetricsGrid({ metrics }: { metrics: Record<string, number> }) {
   return (
-    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-slate-800/80 bg-slate-900/40 p-2.5 text-[11px] text-slate-400">
+    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-ink-800/80 bg-ink-900/40 p-2.5 text-[11px] text-ink-400">
       {Object.entries(metrics).map(([key, value]) => (
         <div key={key} className="contents">
           <dt className="truncate">{key}</dt>
-          <dd className="text-right font-mono font-medium text-slate-200">{value}</dd>
+          <dd className="text-right font-mono font-medium text-ink-200">{value}</dd>
         </div>
       ))}
     </dl>
   )
 }

 export function EventLog({ journal }: { journal: JournalEntry[] }) {
   return (
-    <ul className="space-y-0.5 rounded-lg border border-slate-800/80 bg-slate-900/40 p-2.5 font-mono text-[10px] leading-relaxed text-slate-400">
+    <ul className="space-y-0.5 rounded-lg border border-ink-800/80 bg-ink-900/40 p-2.5 font-mono text-[10px] leading-relaxed text-ink-400">
       {journal
         .slice(-40)
         .reverse()
         .map((entry, i) => (
           <li key={i} className="truncate">
-            <span className="text-slate-600">{(entry.at / 1000).toFixed(1)}s </span>
+            <span className="text-ink-600">{(entry.at / 1000).toFixed(1)}s </span>
             {entry.text}
           </li>
         ))}
     </ul>
   )
 }
```

```diff
       <section>
         <div className="flex items-start justify-between gap-2">
-          <h2 className="mb-1 text-sm font-semibold leading-snug text-slate-100">
+          <h2 className="mb-1 text-sm font-semibold leading-snug text-ink-100">
             <MarkdownInline text={step?.title ?? lesson.title} />
           </h2>
           {ExportDialog && (
             <button
               onClick={() => setExportOpen(true)}
               data-testid="export-button"
-              className="min-h-11 shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 active:bg-slate-700 md:min-h-0"
+              className="min-h-11 shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] font-medium text-ink-200 hover:bg-ink-800 active:bg-ink-700 md:min-h-0"
             >
               Xuất code
             </button>
           )}
         </div>
```

```diff
       <section>
-        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
+        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
           {selectedNodeId ? `Cấu hình · ${selectedNodeId}` : 'Chỉ số'}
         </h3>
         {selectedNodeId ? (
           <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
         ) : (
           <MetricsGrid metrics={broker.metrics(state)} />
         )}
       </section>

       <section className="min-h-0 flex-1">
-        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nhật ký sự kiện</h3>
+        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Nhật ký sự kiện</h3>
         <EventLog journal={state.journal} />
       </section>
```

- [ ] **Step 2: Confirm only `rose-`/`amber-` remain (no `slate-`/`sky-`)**

Run: `grep -nE "slate-|sky-" src/shell/ui/Inspector/Inspector.tsx`
Expected: no output.

Run: `grep -cE "rose-|amber-" src/shell/ui/Inspector/Inspector.tsx`
Expected: `6` (unchanged — `IssuesList`'s 4 `rose-*` classes and `HaltedBanner`'s 2 `amber-*` classes, untouched).

- [ ] **Step 3: Run the App test suite (covers Inspector)**

Run: `npx vitest run src/shell/ui/App.test.tsx`
Expected: PASS, all tests, unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ui/Inspector/Inspector.tsx
git commit -m "refactor(ui): migrate Inspector chrome to ink tokens, leave status colors untouched"
```

---

### Task 8: Migrate layouts + `App.tsx`

**Files:**
- Modify: `src/shell/ui/layouts/DesktopLayout.tsx`
- Modify: `src/shell/ui/layouts/TabletLayout.tsx`
- Modify: `src/shell/ui/layouts/MobileLayout.tsx`
- Modify: `src/shell/ui/App.tsx`
- Test: `src/shell/ui/App.test.tsx` (no changes needed — the `describe('layout responsive', ...)` block asserts testids/roles, not class names)

**Interfaces:**
- Consumes: `ink-*` tokens from Task 1. `src/shell/ui/layouts/SidePanel.tsx` has no `slate-`/`sky-` classes and is not touched by this task.

- [ ] **Step 1: Rename classes in `DesktopLayout.tsx`**

```diff
   return (
-    <div className="flex h-full bg-slate-950 text-slate-100">
-      <aside className="w-64 shrink-0 border-r border-slate-800/80 bg-slate-950">
+    <div className="flex h-full bg-ink-950 text-ink-100">
+      <aside className="w-64 shrink-0 border-r border-ink-800/80 bg-ink-950">
         <LessonSidebar />
       </aside>
       <main className="flex min-w-0 flex-1 flex-col">
         <div className="min-h-0 flex-1">
           <CanvasView
             broker={broker}
             topology={topology}
             state={state}
             script={script}
             highlight={highlight}
             editable={editable}
           />
         </div>
-        <div className="border-t border-slate-800/80 bg-slate-950">
+        <div className="border-t border-ink-800/80 bg-ink-950">
           <StatePanel state={state} />
         </div>
         <Transport durationMs={durationMs} onStep={onStep} />
       </main>
-      <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950 p-3.5">
+      <aside className="w-80 shrink-0 overflow-y-auto border-l border-ink-800/80 bg-ink-950 p-3.5">
         <SidePanel {...props} />
       </aside>
     </div>
   )
```

- [ ] **Step 2: Rename classes in `TabletLayout.tsx`**

```diff
   return (
-    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
+    <div className="flex h-full flex-col bg-ink-950 text-ink-100">
       <TopBar
         title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')}
         onOpenDrawer={() => setDrawerOpen(true)}
       />
       <div className="flex min-h-0 flex-1">
         <main className="flex min-w-0 flex-1 flex-col">
           <div className="min-h-0 flex-1">
             <CanvasView
               broker={broker}
               topology={topology}
               state={state}
               script={script}
               highlight={highlight}
               editable={editable}
             />
           </div>
-          <div className="border-t border-slate-800/80">
+          <div className="border-t border-ink-800/80">
             <StatePanel state={state} dense />
           </div>
           <Transport durationMs={durationMs} onStep={onStep} />
         </main>
-        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950 p-3">
+        <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink-800/80 bg-ink-950 p-3">
           <SidePanel {...props} />
         </aside>
       </div>

       {drawerOpen && (
         <>
           <div
             aria-hidden
             onClick={() => setDrawerOpen(false)}
-            className="fixed inset-0 z-10 bg-slate-950/70 backdrop-blur-sm"
+            className="fixed inset-0 z-10 bg-ink-950/70 backdrop-blur-sm"
           />
-          <aside className="fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-800 bg-slate-950 shadow-2xl shadow-black/50">
+          <aside className="fixed inset-y-0 left-0 z-20 w-64 border-r border-ink-800 bg-ink-950 shadow-2xl shadow-black/50">
             <LessonSidebar hideBrokerSwitcher />
           </aside>
         </>
       )}
     </div>
   )
```

- [ ] **Step 3: Rename classes in `MobileLayout.tsx`**

```diff
   return (
-    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
+    <div className="flex h-full flex-col bg-ink-950 text-ink-100">
       <TopBar title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')} />

       <div className="min-h-0 flex-1">
         {pane === 'lessons' && <LessonSidebar hideBrokerSwitcher />}

         {pane === 'canvas' && (
           <div className="flex h-full flex-col">
             <div className="min-h-0 flex-1">
               <CanvasView
                 broker={broker}
                 topology={topology}
                 state={state}
                 script={script}
                 highlight={highlight}
                 editable={editable}
               />
             </div>
-            <div className="border-t border-slate-800/80">
+            <div className="border-t border-ink-800/80">
               <StatePanel state={state} dense />
             </div>
           </div>
         )}

         {pane === 'state' && (
           <div className="flex h-full flex-col overflow-y-auto">
-            <div className="border-b border-slate-800/80">
+            <div className="border-b border-ink-800/80">
               <StatePanel state={state} />
             </div>
             <div className="min-h-0 flex-1 p-3">
               <SidePanel {...props} />
             </div>
           </div>
         )}
       </div>

       <Transport durationMs={durationMs} onStep={onStep} compact />
       <MobileTabBar />
     </div>
   )
```

- [ ] **Step 4: Rename the class in `App.tsx`**

```diff
-  if (!inSandbox && !lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>
+  if (!inSandbox && !lesson) return <div className="p-4 text-ink-200">Không tìm thấy bài học.</div>
```

- [ ] **Step 5: Confirm no `slate-`/`sky-` left in any of the four files**

Run: `grep -nE "slate-|sky-" src/shell/ui/layouts/DesktopLayout.tsx src/shell/ui/layouts/TabletLayout.tsx src/shell/ui/layouts/MobileLayout.tsx src/shell/ui/App.tsx`
Expected: no output.

- [ ] **Step 6: Run the App test suite**

Run: `npx vitest run src/shell/ui/App.test.tsx`
Expected: PASS, all tests including the entire `describe('layout responsive', ...)` block, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/shell/ui/layouts/DesktopLayout.tsx src/shell/ui/layouts/TabletLayout.tsx src/shell/ui/layouts/MobileLayout.tsx src/shell/ui/App.tsx
git commit -m "refactor(ui): migrate layouts and App root chrome to ink tokens"
```

---

### Task 9: Annotate `index.css` raw hex values with their token names

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- None produced/consumed — this file uses raw CSS, not Tailwind classes. The goal is purely to keep the file greppable back to the token names established in Task 1 (per spec: no CSS custom properties, just a comment annotation).

- [ ] **Step 1: Add token-name comments next to each hex value**

```diff
 body {
   overscroll-behavior: none;
-  background: #020617;
+  background: #020617; /* ink-950 */
 }
```

```diff
   button:focus-visible,
   a:focus-visible,
   input:focus-visible,
   select:focus-visible,
   [role='tab']:focus-visible,
   [role='button']:focus-visible {
-    outline: 2px solid #38bdf8;
+    outline: 2px solid #38bdf8; /* accent-400 */
     outline-offset: 2px;
     border-radius: 4px;
   }
```

```diff
 * {
   scrollbar-width: thin;
-  scrollbar-color: #334155 transparent;
+  scrollbar-color: #334155 transparent; /* ink-700 */
 }

 *::-webkit-scrollbar-thumb {
-  background-color: #334155;
+  background-color: #334155; /* ink-700 */
   border-radius: 9999px;
 }

 *::-webkit-scrollbar-thumb:hover {
-  background-color: #475569;
+  background-color: #475569; /* ink-600 */
 }
```

```diff
 input[type='range'] {
   appearance: none;
   -webkit-appearance: none;
   height: 4px;
   border-radius: 9999px;
-  background: #1e293b;
+  background: #1e293b; /* ink-800 */
 }

 input[type='range']::-webkit-slider-thumb {
   -webkit-appearance: none;
   width: 14px;
   height: 14px;
   border-radius: 9999px;
-  background: #0ea5e9;
-  border: 2px solid #e0f2fe;
+  background: #0ea5e9; /* accent-500 */
+  border: 2px solid #e0f2fe; /* accent-100 */
   cursor: pointer;
   margin-top: 0;
 }

 input[type='range']::-moz-range-thumb {
   width: 14px;
   height: 14px;
   border-radius: 9999px;
-  background: #0ea5e9;
-  border: 2px solid #e0f2fe;
+  background: #0ea5e9; /* accent-500 */
+  border: 2px solid #e0f2fe; /* accent-100 */
   cursor: pointer;
 }

 input[type='range']::-moz-range-track {
   height: 4px;
   border-radius: 9999px;
-  background: #1e293b;
+  background: #1e293b; /* ink-800 */
 }
```

```diff
 .react-flow__controls-button {
-  background: #1e293b !important;
-  border-bottom: 1px solid #334155 !important;
-  fill: #cbd5e1 !important;
+  background: #1e293b !important; /* ink-800 */
+  border-bottom: 1px solid #334155 !important; /* ink-700 */
+  fill: #cbd5e1 !important; /* ink-300 */
 }

 .react-flow__controls-button:hover {
-  background: #334155 !important;
-  fill: #f1f5f9 !important;
+  background: #334155 !important; /* ink-700 */
+  fill: #f1f5f9 !important; /* ink-100 */
 }

 .react-flow__controls-button:disabled {
-  fill: #475569 !important;
+  fill: #475569 !important; /* ink-600 */
 }

 .react-flow__attribution {
   background: transparent;
-  color: #475569;
+  color: #475569; /* ink-600 */
 }
```

```diff
 .react-flow__edge-textbg {
-  fill: #0f172a !important;
+  fill: #0f172a !important; /* ink-900 */
 }

 .react-flow__edge-text {
-  fill: #7dd3fc !important;
+  fill: #7dd3fc !important; /* accent-300 */
   font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
   font-size: 10px;
 }
```

```diff
 .react-flow__handle {
-  background: #0f172a !important;
-  border-color: #475569 !important;
+  background: #0f172a !important; /* ink-900 */
+  border-color: #475569 !important; /* ink-600 */
 }
```

- [ ] **Step 2: Confirm no hex value is missing its comment**

Run: `grep -E "#[0-9a-fA-F]{6}" src/index.css`
Expected: every line in the output ends in a `/* ink-NNN */` or `/* accent-NNN */` comment.

- [ ] **Step 3: Verify the build still works**

Run: `npm run build`
Expected: succeeds (comments don't change CSS semantics; this confirms nothing was accidentally broken while editing).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "docs(ui): annotate index.css hex colors with their ink/accent token names"
```

---

### Task 10: Manual mobile touch/QA pass

**Files:** none (verification only — no code changes expected; if this step finds a genuine problem, stop and report it before making an ad hoc fix, since a real finding here would mean the spec's mobile-UX section was incomplete).

This is the spec's "audit pass" — a checklist run against the live app, not a coding task. Everything it checks was already implemented (3-tier responsive layout, `min-h-11` targets, safe-area insets) per the project README; this task's job is to confirm that with the app running, not to add new structure.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background; note the printed local URL)

- [ ] **Step 2: Open the app and resize to each target viewport**

Using the browser's device toolbar (or `mcp__claude-in-chrome`/DevTools MCP resize tools if available), check at **375×667**, **393×852**, **430×932** (mobile), **768×1024** (tablet), **1280×800** (desktop):

- [ ] No horizontal scrollbar appears at any width (body must not scroll sideways).
- [ ] `MobileTabBar` tabs, `TopBar` hamburger, `Transport` compact buttons, and `LessonSidebar` lesson rows are all comfortably tappable — no visual overlap or clipping at 375px, the narrowest supported width per `CLAUDE.md`.
- [ ] The Dynamic-Island/notch area (`pt-safe`) and home-indicator area (`pb-safe`) are not covered by content — the `TopBar` and `MobileTabBar` should show clear padding at the top/bottom on a viewport with a simulated safe-area inset (DevTools can inject `env(safe-area-inset-*)` via device toolbar presets for notched devices, e.g. "iPhone 14 Pro").
- [ ] Transport's compact-mode scrub bar and speed `<select>` don't visually overlap or truncate awkwardly at 375px.
- [ ] Color rendering after Tasks 1-9 is visually identical to before the migration (spot-check `TopBar`, `MobileTabBar` active tab, `LessonSidebar` active lesson, `Transport` play button) — confirms the rename introduced no accidental hex drift.

- [ ] **Step 3: Record the outcome**

If every checklist item passes: no commit needed, proceed to Task 11. If something fails: stop, describe the concrete failure (viewport, element, what's wrong) instead of guessing a fix — it means the spec under-scoped the mobile-UX section and needs a follow-up decision, not a silent patch.

---

### Task 11: Final full verification

**Files:** none.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, zero failures. Total count is 1214 (README's baseline of 1213 plus the one new test added in Task 6) — no test was removed.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds, produces `dist/`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Confirm zero remaining `slate-`/`sky-` references outside the excluded broker/status files**

Run:
```bash
grep -rlE "slate-|sky-" src --include="*.tsx" --include="*.ts" \
  | grep -vE "src/brokers/.*/(ui|sandbox)/|CheckpointCard\.tsx"
```
Expected: no output — every remaining `slate-`/`sky-` occurrence in the codebase lives inside the explicitly excluded broker node/panel/sandbox files or `CheckpointCard.tsx`, and `Inspector.tsx`'s `rose-`/`amber-` lines don't match this grep so they don't need to appear either.

No commit for this task (nothing changes if all checks pass — it's a gate, not a deliverable).
