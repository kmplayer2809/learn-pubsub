# Shell restyle: color tokens + mobile touch polish

Date: 2026-09-05
Status: approved for planning

## Goal

Restyle looks nicer, more usable, more mobile-optimized, with better-organized
color. Concretely: replace hardcoded Tailwind `slate-*`/`sky-*` classes in the
shell chrome with a semantic token layer (so a future brand/hue change is a
one-line config edit, not a 20-file grep), and fix mobile touch-target/spacing
gaps that fall short of the 44px / 8px guidelines.

## Scope

**In scope — shell chrome only:**

- `src/shell/ui/TopBar/TopBar.tsx`
- `src/shell/ui/MobileTabBar/MobileTabBar.tsx`
- `src/shell/ui/LessonSidebar/LessonSidebar.tsx`
- `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`
- `src/shell/ui/Transport/Transport.tsx`
- `src/shell/ui/Inspector/Inspector.tsx` (outer chrome only — see exclusions)
- `src/shell/ui/layouts/*.tsx` (DesktopLayout, TabletLayout, MobileLayout, SidePanel)
- `src/shell/ui/App.tsx`
- `src/index.css`
- `tailwind.config.js`

**Explicitly out of scope (do not touch):**

- Per-broker canvas node colors (`src/brokers/*/ui/nodes.tsx`,
  `NodeConfig.tsx`, `*Panel.tsx`) — these use a deliberate role-based palette
  (e.g. RabbitMQ: amber=exchange, emerald=queue, violet=DLX; Redis:
  amber/cyan/rose/violet per data structure; Kafka: orange/teal per
  broker/partition role). Not a shell-chrome concern, not requested.
- `CheckpointCard.tsx` status colors (emerald=correct, rose=incorrect,
  amber=hint) — same reasoning, a deliberate status-semantic system.
- Sandbox panels / `ExportDialog.tsx` per broker — untouched unless a later
  pass finds shell-chrome-only classes inside them (not found in this audit).
- Typography, animation, canvas/React Flow node visuals, light mode. None of
  these were selected as in-scope.

## Token design

Tailwind's opacity modifier (`bg-x/80`) works on any custom color defined in
`theme.extend.colors`, so this is a **1:1 renaming of the existing two color
families already in use** — `slate` → `ink` (neutral scale: backgrounds,
borders, text) and `sky` → `accent` (the one accent hue already used for
active states, the play button, and focus rings). No hex value changes, so
this migration is visually a no-op on its own; it exists so a future palette
change touches `tailwind.config.js` only.

Add to `tailwind.config.js` under `theme.extend.colors`:

```js
colors: {
  ink: {
    100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
    500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b',
    900: '#0f172a', 950: '#020617',
  },
  accent: {
    100: '#e0f2fe', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7',
  },
}
```

(Values are exactly Tailwind's stock `slate`/`sky` shades at the indices
already used in the codebase — verified against every `slate-*`/`sky-*`
occurrence in the in-scope files.)

Migration is mechanical: `slate-NNN` → `ink-NNN`, `sky-NNN` → `accent-NNN`,
preserving any opacity suffix (`slate-800/80` → `ink-800/80`) and Tailwind
prefix (`bg-`, `text-`, `border-`, `ring-`, `shadow-`, `fill-`). Apply only
inside the in-scope file list above — broker node/panel/checkpoint files keep
raw `slate`/`sky`/`amber`/`emerald`/etc. as-is.

`src/index.css` raw hex values get the same rename treatment, but as a
comment-annotated literal (no Tailwind class involved there), e.g.:

```css
body {
  background: #020617; /* ink-950 */
}
```

so the file stays greppable back to the token name without introducing CSS
custom properties (not needed — no runtime theme switch exists or is
planned).

## Mobile touch-target / spacing fixes

- `Transport.tsx` compact mode: `gap-1.5` (6px) between adjacent buttons is
  below the 8px minimum spacing guideline for touch targets → change to
  `gap-2` (8px) on the compact branch only (non-compact desktop spacing
  `gap-3` is already fine).
- Audit pass across `MobileTabBar`, `TopBar`, `LessonSidebar`, `Transport`
  compact mode for any interactive element under 44×44px (`min-h-11
  min-w-11` or equivalent) that isn't already covered — expected to mostly
  confirm existing coverage (`min-h-11` is already applied broadly per the
  README's mobile section), fix any gaps found.
- Check `SidePanel.tsx` / `Inspector.tsx` padding at 375px width for cramped
  touch spacing between inspector rows — adjust spacing tokens only, no
  structural change to which pane renders.
- No changes to `useMediaQuery` breakpoints or the three-layout switching
  logic — that structure is correct as-is.

## Testing

Tests asserting specific Tailwind class strings in the in-scope files must be
updated to the new token names:

- `TopBar.test.tsx`, `MobileTabBar.test.tsx`, `LessonSidebar.test.tsx`,
  `BrokerSwitcher.test.tsx`, `Transport.test.tsx` — update any
  `border-sky-400`, `bg-sky-500/10`, `text-slate-*`, etc. assertions to their
  `accent-*`/`ink-*` equivalents.
- No test in broker-specific files (`nodes.test.tsx`, etc.) should need to
  change — they assert role colors, which are untouched.
- Run full suite (`npm test`) and `npm run typecheck` after migration;
  `src/shell/lesson/language.test.ts` and `purity.test.ts` are unaffected
  (no lesson content or engine code touched).

## Risks

- Low risk: token rename preserves exact hex values, so any visual diff is a
  bug in the migration, not an intended change — easy to catch by comparing
  before/after screenshots at 375px, 768px, 1024px.
- The mobile spacing fix (`gap-1.5` → `gap-2`) is the only line with an
  actual pixel-level visual change; verify the Transport bar still fits on a
  375px-wide viewport without wrapping.
