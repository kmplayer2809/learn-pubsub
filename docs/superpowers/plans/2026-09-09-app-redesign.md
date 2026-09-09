# App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay hệ màu numeric bằng một tầng token ngữ nghĩa chạy được cả light lẫn dark, rồi sửa những chỗ bố cục đang làm hỏng việc học (canvas trống, node không đọc được ở mobile, thanh tua không có mốc, panel phẳng, chrome lệch giữa ba breakpoint).

**Architecture:** CSS custom property đặt trên `<html data-theme>` là nguồn sự thật duy nhất cho màu; `tailwind.config.js` bọc chúng lại thành tên ngữ nghĩa (`surface`, `content`, `edge`, `accent`, `role-*`, `ok`/`danger`/`warn`) qua cú pháp `rgb(var(--x) / <alpha-value>)`, nên một class list chạy được cả hai theme và opacity modifier vẫn hoạt động. Bố cục giữ nguyên ba layout theo breakpoint; thay đổi nằm ở việc thống nhất `TopBar` cho cả ba, chia `Inspector` thành hai vùng cuộn, và đặt sàn zoom cho `fitView`.

**Tech Stack:** React 19, TypeScript (strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `erasableSyntaxOnly`), Tailwind CSS 3.4, Zustand 5, `@xyflow/react` 12, Vitest 4 + Testing Library + jsdom, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-09-app-redesign-design.md`

## Global Constraints

Áp dụng cho **mọi** task bên dưới. Đọc hết trước khi bắt đầu task đầu tiên.

- **Typecheck luôn dùng `npm run typecheck`.** KHÔNG BAO GIỜ chạy `npx tsc --noEmit`: `tsconfig.json` ở root là project-references với `"files": []`, lệnh đó compile 0 file và luôn exit 0 kể cả khi code hỏng.
- **Không đụng `src/shell/kernel/**` hay `src/brokers/*/engine/**`.** Toàn bộ plan này chỉ sửa file UI, config, và `src/shell/store.ts`. `src/shell/kernel/purity.test.ts` sẽ đỏ nếu vi phạm.
- **Không sửa một chữ nào của lesson copy** (`summary`, `narrative[].title`, `narrative[].body`, `checkpoints[]`). `src/shell/lesson/language.test.ts` canh việc này.
- **Không đổi `BrokerModule` contract** trong `src/brokers/types.ts` và không đổi shape của `Lesson`.
- **Giữ nguyên mọi `data-testid`.** Chúng là điểm neo của test cấu trúc layout.
- **Giữ nguyên mọi comment giải thích "tại sao"** trong file bạn sửa. Codebase này dùng comment để ghi lại bug đã sửa; xoá chúng là mở đường cho bug quay lại. Nếu comment nói về class màu cũ, cập nhật tên màu trong comment, giữ nguyên nội dung lập luận.
- **`import type` cho mọi import chỉ dùng ở vị trí type** (`verbatimModuleSyntax` bật).
- Suite đầy đủ: `npm test` (~90 file, ~1213 test, ~7s). Chạy trước khi commit ở mỗi task.
- Lint: `npm run lint` (oxlint).
- Commit message tiếng Anh, prefix theo Conventional Commits (`feat`/`fix`/`refactor`/`docs`/`style`/`test`).

### Bảng giá trị token đầy đủ

Mọi task tham chiếu bảng này. Giá trị viết dạng ba kênh RGB, cách nhau bằng dấu cách (cú pháp `<alpha-value>` của Tailwind yêu cầu vậy).

**Theme-varying (thành CSS var):**

| Var | light | dark |
|---|---|---|
| `--canvas` | `226 232 240` | `2 6 23` |
| `--surface` | `255 255 255` | `11 18 32` |
| `--surface-raised` | `248 250 252` | `19 28 46` |
| `--surface-hover` | `241 245 249` | `30 41 59` |
| `--border-subtle` | `226 232 240` | `30 41 59` |
| `--border-strong` | `203 213 225` | `51 65 85` |
| `--text-strong` | `15 23 42` | `241 245 249` |
| `--text-body` | `51 65 85` | `203 213 225` |
| `--text-muted` | `100 116 139` | `148 163 184` |
| `--text-faint` | `100 116 139` | `148 163 184` |
| `--accent` | `2 132 199` | `56 189 248` |
| `--accent-hover` | `3 105 161` | `125 211 252` |
| `--accent-fg` | `255 255 255` | `2 6 23` |
| `--accent-soft` | `224 242 254` | `12 74 110` |
| `--highlight` | `192 38 211` | `232 121 249` |
| `--ok-bg` | `236 253 245` | `2 44 34` |
| `--ok-fg` | `6 95 70` | `167 243 208` |
| `--danger-bg` | `255 241 242` | `76 5 25` |
| `--danger-fg` | `159 18 57` | `254 205 211` |
| `--warn-bg` | `255 251 235` | `69 26 3` |
| `--warn-fg` | `146 64 14` | `253 230 138` |
| `--tone-sky` | `2 132 199` | `56 189 248` |
| `--tone-emerald` | `5 150 105` | `52 211 153` |
| `--tone-rose` | `225 29 72` | `251 113 133` |
| `--tone-amber` | `217 119 6` | `251 191 36` |
| `--shadow-node` | `0 1px 2px rgb(15 23 42 / 0.08), 0 2px 8px rgb(15 23 42 / 0.06)` | `inset 0 0 0 1px rgb(255 255 255 / 0.04)` |

**Role — bg/fg theo theme:**

| hue | light bg (50) | light fg (800) | dark bg (950) | dark fg (200) |
|---|---|---|---|---|
| sky | `240 249 255` | `7 89 133` | `8 47 73` | `186 230 253` |
| violet | `245 243 255` | `91 33 182` | `46 16 101` | `221 214 254` |
| emerald | `236 253 245` | `6 95 70` | `2 44 34` | `167 243 208` |
| amber | `255 251 235` | `146 64 14` | `69 26 3` | `253 230 138` |
| cyan | `236 254 255` | `21 94 117` | `8 51 68` | `165 243 252` |
| rose | `255 241 242` | `159 18 57` | `76 5 25` | `254 205 211` |
| blue | `239 246 255` | `30 64 175` | `23 37 84` | `191 219 254` |
| teal | `240 253 250` | `17 94 89` | `4 47 46` | `153 246 228` |
| orange | `255 247 237` | `154 52 18` | `67 20 7` | `254 215 170` |
| pink | `253 242 248` | `157 23 77` | `80 7 36` | `251 207 232` |
| lime | `247 254 231` | `63 98 18` | `26 46 5` | `217 249 157` |

**Không đổi theo theme (hex thẳng trong `tailwind.config.js`, KHÔNG thành var):**

| Token | hex | Ghi chú |
|---|---|---|
| `role.<hue>.line` | hue-500 | sky `#0ea5e9`, violet `#8b5cf6`, emerald `#10b981`, amber `#f59e0b`, cyan `#06b6d4`, rose `#f43f5e`, blue `#3b82f6`, teal `#14b8a6`, orange `#f97316`, pink `#ec4899`, lime `#84cc16` |
| `role.<hue>.ring` | hue-400 | sky `#38bdf8`, violet `#a78bfa`, emerald `#34d399`, amber `#fbbf24`, cyan `#22d3ee`, rose `#fb7185`, blue `#60a5fa`, teal `#2dd4bf`, orange `#fb923c`, pink `#f472b6`, lime `#a3e635` |
| `ok.line` | `#059669` | emerald-600 |
| `danger.line` | `#e11d48` | rose-600 |
| `warn.line` | `#d97706` | amber-600 |

### Type scale (`theme.extend.fontSize`)

| Token | Giá trị |
|---|---|
| `narrative` | `['15px', { lineHeight: '1.65' }]` |
| `ui` | `['13px', { lineHeight: '1.5' }]` |
| `meta` | `['11px', { lineHeight: '1.45' }]` |
| `code` | `['12px', { lineHeight: '1.5' }]` |
| `section` | `['10px', { lineHeight: '1', letterSpacing: '0.08em' }]` |

---

## Cấu trúc file

**Tạo mới:**

| File | Trách nhiệm |
|---|---|
| `src/shell/ui/theme.ts` | Đọc/ghi theme (`localStorage` + `matchMedia` + `data-theme`). Thuần, không React. |
| `src/shell/ui/theme.test.ts` | Test cho trên. |
| `src/shell/ui/ThemeToggle/ThemeToggle.tsx` | Nút đổi theme. |
| `src/shell/ui/ThemeToggle/ThemeToggle.test.tsx` | Test cho trên. |
| `src/shell/ui/Inspector/InspectorTabs.tsx` | Tab strip Chỉ số / Nhật ký / Cấu hình + panel tương ứng. |
| `src/shell/ui/Inspector/InspectorTabs.test.tsx` | Test cho trên. |
| `src/shell/ui/Transport/ScrubTrack.tsx` | Thanh tua: range input + vạch mốc + track tô màu. |
| `src/shell/ui/Transport/ScrubTrack.test.tsx` | Test cho trên. |
| `scripts/contrast-audit.mjs` | Script kiểm tương phản cặp token, chạy tay ở Task 10. |

**Sửa:**

`index.html`, `tailwind.config.js`, `package.json`, `src/index.css`, `src/shell/store.ts`, `src/shell/ui/App.tsx`, `src/shell/ui/icons.tsx`, `src/shell/ui/layouts/types.ts`, `src/shell/ui/layouts/{Desktop,Tablet,Mobile}Layout.tsx`, `src/shell/ui/layouts/SidePanel.tsx`, `src/shell/ui/TopBar/TopBar.tsx`, `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`, `src/shell/ui/LessonSidebar/LessonSidebar.tsx`, `src/shell/ui/MobileTabBar/MobileTabBar.tsx`, `src/shell/ui/Transport/Transport.tsx`, `src/shell/ui/Inspector/{Inspector,CheckpointCard,Markdown}.tsx`, `src/shell/ui/CanvasView/CanvasView.tsx`, `src/shell/ui/canvas/{MessageLayer.tsx,geometry.ts}`, `src/brokers/{rabbitmq,redis,kafka}/ui/**`, `src/brokers/{rabbitmq,kafka}/sandbox/**`, và các file test tương ứng.

---

## Task 1: Token infrastructure

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: không có (task đầu).
- Produces: mọi tên class Tailwind ngữ nghĩa dùng ở Task 4–8 — `bg-canvas`, `bg-surface`, `bg-surface-raised`, `bg-surface-hover`, `border-edge`, `border-edge-strong`, `text-content-strong`, `text-content`, `text-content-muted`, `text-content-faint`, `bg-accent`, `bg-accent-hover`, `text-accent`, `text-accent-fg`, `bg-accent-soft`, `outline-highlight`, `bg-role-<hue>`, `border-role-<hue>-line`, `text-role-<hue>-fg`, `ring-role-<hue>-ring`, `bg-ok-bg`/`text-ok-fg`/`border-ok-line` (và `danger`, `warn` cùng shape), `shadow-node`, `text-narrative`/`text-ui`/`text-meta`/`text-code`/`text-section`. Attribute `data-theme` trên `<html>`.

- [ ] **Step 1: Thêm khối biến vào `src/index.css`**

Chèn ngay **sau** ba dòng `@tailwind` ở đầu file, **trước** rule `html, body, #root`:

```css
/*
 * Nguồn sự thật duy nhất cho màu. `tailwind.config.js` chỉ bọc các biến này lại
 * thành tên ngữ nghĩa — không có hex nào sống trong config ngoài những giá trị
 * cố ý không đổi theo theme (role line/ring, status line).
 *
 * Viết ba kênh RGB cách nhau bằng dấu cách chứ không phải `#hex`: cú pháp
 * `rgb(var(--x) / <alpha-value>)` của Tailwind cần đúng dạng này để opacity
 * modifier (`bg-surface/80`) còn dùng được. Đổi sang `#hex` là làm chết lặng
 * mọi class có `/`.
 */
:root {
  --canvas: 226 232 240;
  --surface: 255 255 255;
  --surface-raised: 248 250 252;
  --surface-hover: 241 245 249;
  --border-subtle: 226 232 240;
  --border-strong: 203 213 225;
  --text-strong: 15 23 42;
  --text-body: 51 65 85;
  --text-muted: 100 116 139;
  /* Bằng --text-muted, không nhạt hơn: mọi chỗ dùng `faint` đều là chữ 10-11px,
     không được hưởng ngoại lệ "large text" của WCAG, và mức nhạt hơn (#64748b
     trên nền tối) chỉ đạt 3.95:1. Giữ tên riêng để chỗ dùng vẫn nói đúng ý đồ. */
  --text-faint: 100 116 139;
  --accent: 2 132 199;
  --accent-hover: 3 105 161;
  --accent-fg: 255 255 255;
  --accent-soft: 224 242 254;
  --highlight: 192 38 211;

  --ok-bg: 236 253 245;
  --ok-fg: 6 95 70;
  --danger-bg: 255 241 242;
  --danger-fg: 159 18 57;
  --warn-bg: 255 251 235;
  --warn-fg: 146 64 14;

  --tone-sky: 2 132 199;
  --tone-emerald: 5 150 105;
  --tone-rose: 225 29 72;
  --tone-amber: 217 119 6;

  --shadow-node: 0 1px 2px rgb(15 23 42 / 0.08), 0 2px 8px rgb(15 23 42 / 0.06);

  --role-sky-bg: 240 249 255;     --role-sky-fg: 7 89 133;
  --role-violet-bg: 245 243 255;  --role-violet-fg: 91 33 182;
  --role-emerald-bg: 236 253 245; --role-emerald-fg: 6 95 70;
  --role-amber-bg: 255 251 235;   --role-amber-fg: 146 64 14;
  --role-cyan-bg: 236 254 255;    --role-cyan-fg: 21 94 117;
  --role-rose-bg: 255 241 242;    --role-rose-fg: 159 18 57;
  --role-blue-bg: 239 246 255;    --role-blue-fg: 30 64 175;
  --role-teal-bg: 240 253 250;    --role-teal-fg: 17 94 89;
  --role-orange-bg: 255 247 237;  --role-orange-fg: 154 52 18;
  --role-pink-bg: 253 242 248;    --role-pink-fg: 157 23 77;
  --role-lime-bg: 247 254 231;    --role-lime-fg: 63 98 18;
}

[data-theme='dark'] {
  --canvas: 2 6 23;
  --surface: 11 18 32;
  --surface-raised: 19 28 46;
  --surface-hover: 30 41 59;
  --border-subtle: 30 41 59;
  --border-strong: 51 65 85;
  --text-strong: 241 245 249;
  --text-body: 203 213 225;
  --text-muted: 148 163 184;
  --text-faint: 148 163 184;
  --accent: 56 189 248;
  --accent-hover: 125 211 252;
  --accent-fg: 2 6 23;
  --accent-soft: 12 74 110;
  --highlight: 232 121 249;

  --ok-bg: 2 44 34;
  --ok-fg: 167 243 208;
  --danger-bg: 76 5 25;
  --danger-fg: 254 205 211;
  --warn-bg: 69 26 3;
  --warn-fg: 253 230 138;

  --tone-sky: 56 189 248;
  --tone-emerald: 52 211 153;
  --tone-rose: 251 113 133;
  --tone-amber: 251 191 36;

  /* Bóng đổ vô hình trên nền gần đen. Thay bằng một viền sáng mảnh bên trong —
     cùng vai trò "nhấc node khỏi nền", khác cơ chế. */
  --shadow-node: inset 0 0 0 1px rgb(255 255 255 / 0.04);

  --role-sky-bg: 8 47 73;        --role-sky-fg: 186 230 253;
  --role-violet-bg: 46 16 101;   --role-violet-fg: 221 214 254;
  --role-emerald-bg: 2 44 34;    --role-emerald-fg: 167 243 208;
  --role-amber-bg: 69 26 3;      --role-amber-fg: 253 230 138;
  --role-cyan-bg: 8 51 68;       --role-cyan-fg: 165 243 252;
  --role-rose-bg: 76 5 25;       --role-rose-fg: 254 205 211;
  --role-blue-bg: 23 37 84;      --role-blue-fg: 191 219 254;
  --role-teal-bg: 4 47 46;       --role-teal-fg: 153 246 228;
  --role-orange-bg: 67 20 7;     --role-orange-fg: 254 215 170;
  --role-pink-bg: 80 7 36;       --role-pink-fg: 251 207 232;
  --role-lime-bg: 26 46 5;       --role-lime-fg: 217 249 157;
}
```

- [ ] **Step 2: Đổi `body` background sang biến**

Trong `src/index.css`, sửa rule `body`:

```css
body {
  /* Chặn bounce và pull-to-refresh của Safari iOS: canvas được pan bằng một
     ngón, và không có dòng này thì mỗi cú pan dọc lại kéo cả trang. */
  overscroll-behavior: none;
  background: rgb(var(--canvas));
}
```

- [ ] **Step 3: Viết `tailwind.config.js`**

Thay toàn bộ khối `theme.extend` (xoá hẳn `ink` và `accent` numeric — hai hệ song song là đường cho class chỉ đúng một theme lọt vào mà không ai thấy):

```js
/** @type {import('tailwindcss').Config} */

// `line` và `ring` của mỗi role giữ đúng một giá trị ở cả hai theme, nên viết hex
// thẳng ở đây thay vì tạo thêm 22 CSS var không bao giờ đổi. Var chỉ tồn tại cho
// thứ thực sự đổi theo theme.
const ROLE_LINE_RING = {
  sky: ['#0ea5e9', '#38bdf8'],
  violet: ['#8b5cf6', '#a78bfa'],
  emerald: ['#10b981', '#34d399'],
  amber: ['#f59e0b', '#fbbf24'],
  cyan: ['#06b6d4', '#22d3ee'],
  rose: ['#f43f5e', '#fb7185'],
  blue: ['#3b82f6', '#60a5fa'],
  teal: ['#14b8a6', '#2dd4bf'],
  orange: ['#f97316', '#fb923c'],
  pink: ['#ec4899', '#f472b6'],
  lime: ['#84cc16', '#a3e635'],
}

const role = Object.fromEntries(
  Object.entries(ROLE_LINE_RING).map(([hue, [line, ring]]) => [
    hue,
    {
      DEFAULT: `rgb(var(--role-${hue}-bg) / <alpha-value>)`,
      fg: `rgb(var(--role-${hue}-fg) / <alpha-value>)`,
      line,
      ring,
    },
  ]),
)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
        },
        edge: {
          DEFAULT: 'rgb(var(--border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
        },
        content: {
          DEFAULT: 'rgb(var(--text-body) / <alpha-value>)',
          strong: 'rgb(var(--text-strong) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          faint: 'rgb(var(--text-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
        },
        highlight: 'rgb(var(--highlight) / <alpha-value>)',
        ok: {
          bg: 'rgb(var(--ok-bg) / <alpha-value>)',
          fg: 'rgb(var(--ok-fg) / <alpha-value>)',
          line: '#059669',
        },
        danger: {
          bg: 'rgb(var(--danger-bg) / <alpha-value>)',
          fg: 'rgb(var(--danger-fg) / <alpha-value>)',
          line: '#e11d48',
        },
        warn: {
          bg: 'rgb(var(--warn-bg) / <alpha-value>)',
          fg: 'rgb(var(--warn-fg) / <alpha-value>)',
          line: '#d97706',
        },
        role,
      },
      fontSize: {
        narrative: ['15px', { lineHeight: '1.65' }],
        ui: ['13px', { lineHeight: '1.5' }],
        meta: ['11px', { lineHeight: '1.45' }],
        code: ['12px', { lineHeight: '1.5' }],
        section: ['10px', { lineHeight: '1', letterSpacing: '0.08em' }],
      },
      boxShadow: {
        node: 'var(--shadow-node)',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 4: Thêm script chống chớp theme vào `index.html`**

Chèn vào `<head>`, **sau** thẻ `<title>`:

```html
    <script>
      /*
       * Phải chạy đồng bộ trong <head>, trước khi React mount. Không có nó, trang
       * vẽ một frame ở theme mặc định rồi mới nhảy sang theme thật — chớp trắng
       * vào mắt người dùng dark mode.
       *
       * try/catch bắt buộc: localStorage ném SecurityError ở Safari private mode
       * và một exception chưa bắt ở đây làm trắng cả trang.
       */
      ;(function () {
        var saved = null
        try {
          saved = localStorage.getItem('theme')
        } catch (e) {
          /* private mode — rơi về prefers-color-scheme */
        }
        var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      })()
    </script>
```

- [ ] **Step 5: Xác nhận build vẫn chạy**

Chạy: `npm run build`
Kỳ vọng: **FAIL**. Tailwind không nhận diện được `bg-ink-950`, `text-ink-100`... nữa vì `ink`/`accent` numeric đã bị xoá — nhưng Tailwind không báo lỗi cho class lạ, nó chỉ bỏ qua. Build sẽ **PASS**, còn giao diện thì mất sạch màu.

Đây là trạng thái trung gian có chủ ý: Task 4 và 5 di trú class. Xác nhận `npm run build` exit 0 và `npm run typecheck` exit 0, rồi đi tiếp.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.js src/index.css index.html
git commit -m "feat(ui): add semantic CSS-variable token layer for light/dark themes"
```

---

## Task 2: Theme state + toggle

**Files:**
- Create: `src/shell/ui/theme.ts`
- Create: `src/shell/ui/theme.test.ts`
- Create: `src/shell/ui/ThemeToggle/ThemeToggle.tsx`
- Create: `src/shell/ui/ThemeToggle/ThemeToggle.test.tsx`
- Modify: `src/shell/store.ts`
- Modify: `src/shell/ui/icons.tsx`

**Interfaces:**
- Consumes: attribute `data-theme` từ Task 1.
- Produces:
  - `export type Theme = 'light' | 'dark'`
  - `export function readStoredTheme(): Theme | null`
  - `export function resolveInitialTheme(): Theme`
  - `export function applyTheme(theme: Theme): void` — ghi `document.documentElement.dataset.theme` và `localStorage`
  - Store: `theme: Theme`, `setTheme(theme: Theme): void`, `toggleTheme(): void`
  - `<ThemeToggle />` (không prop)
  - `SunIcon`, `MoonIcon` trong `icons.tsx`

- [ ] **Step 1: Viết test cho `theme.ts`**

Tạo `src/shell/ui/theme.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, readStoredTheme, resolveInitialTheme } from './theme'

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') && prefersDark,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('đọc giá trị đã lưu', () => {
    localStorage.setItem('theme', 'light')
    expect(readStoredTheme()).toBe('light')
  })

  it('bỏ qua giá trị rác trong localStorage', () => {
    localStorage.setItem('theme', 'neon')
    expect(readStoredTheme()).toBeNull()
  })

  it('trả null khi localStorage ném lỗi (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(readStoredTheme()).toBeNull()
  })

  it('giá trị đã lưu thắng prefers-color-scheme', () => {
    mockMatchMedia(true)
    localStorage.setItem('theme', 'light')
    expect(resolveInitialTheme()).toBe('light')
  })

  it('không có giá trị lưu thì theo prefers-color-scheme', () => {
    mockMatchMedia(true)
    expect(resolveInitialTheme()).toBe('dark')
    mockMatchMedia(false)
    expect(resolveInitialTheme()).toBe('light')
  })

  it('applyTheme ghi data-theme và localStorage', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('applyTheme vẫn set data-theme khi localStorage ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => applyTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/theme.test.ts`
Kỳ vọng: FAIL — `Failed to resolve import "./theme"`.

- [ ] **Step 3: Viết `src/shell/ui/theme.ts`**

```ts
/**
 * Đọc/ghi theme. Tách khỏi store và khỏi React vì cùng một logic phải chạy ở hai
 * nơi: script đồng bộ trong `index.html` (bản chép tay, không import được) và
 * store lúc khởi tạo. Giữ nó thuần để test được mà không dựng component.
 */
export type Theme = 'light' | 'dark'

const KEY = 'theme'

/**
 * `localStorage` ném `SecurityError` ở Safari private mode. Mọi lần chạm vào nó
 * trong file này đều phải bọc try/catch — một exception chưa bắt lúc khởi tạo
 * store làm trắng cả trang.
 */
export function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

export function resolveInitialTheme(): Theme {
  const stored = readStoredTheme()
  if (stored) return stored
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  // DOM trước, storage sau: nếu storage ném lỗi thì giao diện vẫn đổi đúng.
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private mode — lựa chọn không sống qua reload, giao diện vẫn đúng */
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Chạy: `npx vitest run src/shell/ui/theme.test.ts`
Kỳ vọng: PASS, 7 test.

- [ ] **Step 5: Thêm `theme` vào store**

Trong `src/shell/store.ts`:

Thêm import ở đầu file:

```ts
import { applyTheme, resolveInitialTheme, type Theme } from './ui/theme'
```

Thêm vào `interface AppState`, ngay sau `drawerOpen: boolean`:

```ts
  /** Giao diện sáng/tối. `applyTheme` là nơi duy nhất chạm vào `data-theme` và
   *  `localStorage`; store chỉ giữ giá trị để component render lại. */
  theme: Theme
```

Thêm vào phần khai báo action của interface:

```ts
  setTheme(theme: Theme): void
  toggleTheme(): void
```

Trong `create<AppState>((set, get) => {`, thêm sau `const lessonId = ...`:

```ts
  const theme = resolveInitialTheme()
```

Thêm vào object trả về, sau `drawerOpen: false,`:

```ts
    theme,
```

Thêm hai action, đặt cạnh `setDrawerOpen`:

```ts
    setTheme(theme) {
      applyTheme(theme)
      set({ theme })
    },

    toggleTheme() {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark')
    },
```

> Lưu ý: `store.ts` **không** import component nào — `./ui/theme` chỉ export hàm thuần và type. `src/shell/store.importOrder.test.ts` canh đúng chuyện này; đừng import gì từ `./ui/ThemeToggle/ThemeToggle` vào đây.

- [ ] **Step 6: Thêm hai icon**

Thêm vào cuối `src/shell/ui/icons.tsx`:

```tsx
export function SunIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  )
}

export function MoonIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  )
}
```

- [ ] **Step 7: Viết test cho `ThemeToggle`**

Tạo `src/shell/ui/ThemeToggle/ThemeToggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../store'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useAppStore.getState().setTheme('dark')
  })

  it('mang nhãn tiếng Việt và aria-pressed theo theme hiện tại', () => {
    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Đổi giao diện sáng/tối' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('bấm thì đổi theme trong store và đổi data-theme', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Đổi giao diện sáng/tối' }))
    expect(useAppStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 8: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/ThemeToggle/ThemeToggle.test.tsx`
Kỳ vọng: FAIL — không resolve được `./ThemeToggle`.

- [ ] **Step 9: Viết `ThemeToggle.tsx`**

```tsx
import { useAppStore } from '../../store'
import { MoonIcon, SunIcon } from '../icons'

/**
 * `aria-pressed` chứ không phải hai nút riêng: đây là một công tắc hai trạng thái,
 * và screen reader đọc được trạng thái hiện tại mà không cần chữ phụ. Icon hiển
 * thị là icon của theme sẽ chuyển tới, không phải theme đang dùng — nút cho biết
 * bấm vào sẽ được gì.
 */
export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  return (
    <button
      onClick={toggleTheme}
      aria-label="Đổi giao diện sáng/tối"
      aria-pressed={theme === 'dark'}
      data-testid="theme-toggle"
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-hover hover:text-content-strong active:bg-surface-hover md:min-h-9 md:min-w-9"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
```

- [ ] **Step 10: Chạy test và typecheck**

Chạy: `npx vitest run src/shell/ui/ThemeToggle src/shell/ui/theme.test.ts && npm run typecheck`
Kỳ vọng: PASS toàn bộ, typecheck exit 0.

- [ ] **Step 11: Chạy full suite**

Chạy: `npm test`
Kỳ vọng: PASS. `ThemeToggle` chưa được render ở đâu nên không file test nào khác bị ảnh hưởng.

- [ ] **Step 12: Commit**

```bash
git add src/shell/ui/theme.ts src/shell/ui/theme.test.ts src/shell/ui/ThemeToggle src/shell/store.ts src/shell/ui/icons.tsx
git commit -m "feat(ui): add theme state, persistence, and toggle control"
```

---

## Task 3: Fonts + type scale

**Files:**
- Modify: `package.json`
- Modify: `src/main.tsx`
- Modify: `tailwind.config.js`

**Interfaces:**
- Consumes: `theme.extend.fontSize` từ Task 1.
- Produces: `font-sans` = IBM Plex Sans, `font-mono` = JetBrains Mono trên toàn app.

- [ ] **Step 1: Cài font**

```bash
npm install @fontsource-variable/ibm-plex-sans @fontsource-variable/jetbrains-mono
```

Self-host chứ không link Google Fonts: app là teaching app chạy được offline, và một lần fetch hỏng đẩy narrative tiếng Việt về system font có metric khác hẳn.

- [ ] **Step 2: Import subset ở `src/main.tsx`**

Thêm ngay **trước** dòng `import './index.css'` (thứ tự quan trọng: `@font-face` phải vào trước để `index.css` ghi đè được nếu cần):

```ts
// Chỉ hai subset. Bộ đầy đủ kéo theo cyrillic/greek mà app này không dùng chữ nào.
// `vietnamese` là bắt buộc — toàn bộ narrative có dấu.
import '@fontsource-variable/ibm-plex-sans/vietnamese.css'
import '@fontsource-variable/ibm-plex-sans/latin.css'
import '@fontsource-variable/jetbrains-mono/vietnamese.css'
import '@fontsource-variable/jetbrains-mono/latin.css'
```

Nếu package không có file subset `vietnamese.css` (kiểm bằng `ls node_modules/@fontsource-variable/ibm-plex-sans/`), rơi về `import '@fontsource-variable/ibm-plex-sans'` (bộ đầy đủ) và ghi lại lý do trong comment ngay tại chỗ.

- [ ] **Step 3: Khai báo font family trong `tailwind.config.js`**

Thêm vào `theme.extend`, cạnh `fontSize`:

```js
      fontFamily: {
        sans: ['IBM Plex Sans Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
```

Tên family phải khớp đúng tên `@fontsource-variable` đăng ký. Kiểm bằng:
`grep -h "font-family" node_modules/@fontsource-variable/ibm-plex-sans/*.css | head -1`

- [ ] **Step 4: Đặt `font-sans` lên gốc**

Trong `src/index.css`, thêm vào rule `body`:

```css
  font-family: theme('fontFamily.sans');
```

- [ ] **Step 5: Đồng bộ font nhãn edge của React Flow**

Trong `src/index.css`, rule `.react-flow__edge-text` đang hardcode
`font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`. Đổi thành:

```css
  font-family: theme('fontFamily.mono');
```

- [ ] **Step 6: Kiểm bằng mắt + test**

Chạy: `npm run dev`, mở trang, xác nhận chữ đã đổi và **dấu tiếng Việt hiển thị đúng** (kiểm cụ thể chuỗi "Publisher không bao giờ ghi thẳng vào queue" — có ô, ơ, ă, ê, ẳ).

Chạy: `npm test && npm run typecheck && npm run build`
Kỳ vọng: PASS cả ba.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/index.css tailwind.config.js
git commit -m "feat(ui): self-host IBM Plex Sans + JetBrains Mono and add type scale"
```

---

## Task 4: Di trú màu — shell

**Files:**
- Modify: mọi file dưới `src/shell/ui/` có class `ink-*` / `accent-*` / `slate-*` / `sky-*` / hex cứng
- Modify: `src/index.css` (phần React Flow override và range input)

**Interfaces:**
- Consumes: token từ Task 1, type scale từ Task 3.
- Produces: `src/shell/**` không còn tham chiếu màu numeric nào.

- [ ] **Step 1: Liệt kê chỗ phải sửa**

```bash
grep -rn "ink-[0-9]\|accent-[0-9]\|slate-[0-9]\|sky-[0-9]" src/shell --include="*.tsx" --include="*.ts" | grep -v "\.test\."
```

Ghi lại danh sách; đây là checklist của bạn. Sửa hết, không sót file nào.

- [ ] **Step 2: Bảng ánh xạ**

Áp dụng đúng bảng này. Không tự sáng tạo — sai một chỗ là một class chỉ đúng ở một theme:

`bg-ink-950` xuất hiện ở hai vai trò khác nhau — đừng ánh xạ máy móc, đọc kỹ hai dòng đầu:

| Cũ | Mới |
|---|---|
| `bg-ink-950` trên **`<div>` ngoài cùng của ba layout** (`DesktopLayout`, `TabletLayout`, `MobileLayout`) — đây là nền trang, chỗ canvas ngồi lên | `bg-canvas` |
| `bg-ink-950` ở **mọi chỗ khác** (sidebar `<aside>`, panel phải `<aside>`, drawer, `TopBar`, `Transport`, `MobileTabBar`, wrapper `StatePanel`) — đây là mặt panel | `bg-surface` |
| `bg-ink-950/95` | `bg-surface/95` |
| `bg-ink-900/40`, `bg-ink-900/70` (nền card) | `bg-surface-raised` |
| `bg-ink-900`, `bg-ink-800`, `bg-ink-800/60` (hover/active) | `bg-surface-hover` |
| `border-ink-800/80`, `border-ink-800` | `border-edge` |
| `border-ink-700`, `border-ink-600` | `border-edge-strong` |
| `text-ink-100` | `text-content-strong` |
| `text-ink-200`, `text-ink-300` | `text-content` |
| `text-ink-400` | `text-content-muted` |
| `text-ink-500`, `text-ink-600` | `text-content-faint` |
| `bg-accent-600`, `bg-accent-500` | `bg-accent` |
| `hover:bg-accent-500` | `hover:bg-accent-hover` |
| `bg-accent-500/10`, `bg-accent-500/15` | `bg-accent-soft` |
| `text-accent-300` | `text-accent` |
| `text-white` (chữ trên nền accent) | `text-accent-fg` |
| `border-accent-400`, `ring-accent-500/40` | `border-accent`, `ring-accent` |
| `border-rose-800/60`, `bg-rose-950/60`, `text-rose-200`, `text-rose-300` | `border-danger-line`, `bg-danger-bg`, `text-danger-fg` |
| `border-amber-700/60`, `bg-amber-950/60`, `text-amber-200` | `border-warn-line`, `bg-warn-bg`, `text-warn-fg` |
| `border-emerald-600`, `bg-emerald-950`, `text-emerald-100`, `text-emerald-300`, `border-emerald-500`, `bg-emerald-500/5` | `border-ok-line`, `bg-ok-bg`, `text-ok-fg` |
| `border-rose-600`, `bg-rose-950`, `text-rose-100` (CheckpointCard sai) | `border-danger-line`, `bg-danger-bg`, `text-danger-fg` |
| `border-slate-700`, `border-slate-800`, `border-slate-600` | `border-edge` / `border-edge-strong` |
| `bg-slate-900/70`, `bg-slate-800` | `bg-surface-raised` / `bg-surface-hover` |
| `text-slate-200`, `text-slate-300` | `text-content` |
| `text-slate-500` | `text-content-faint` |
| `shadow-black/20`, `shadow-black/50`, `shadow-accent-950/50` | bỏ hẳn — bóng đen cứng sai trên light theme; dùng `shadow-sm` |

**Type scale**, áp cùng lúc:

| Cũ | Mới |
|---|---|
| `text-sm` (narrative body, câu hỏi checkpoint) | `text-narrative` |
| `text-xs` (label, nút, tiêu đề lesson) | `text-ui` |
| `text-[11px]` | `text-meta` |
| `text-[10px]` trong khối `font-mono` (EventLog) | `text-code` |
| `text-[10px] uppercase tracking-wider` (tiêu đề section) | `text-section` |

- [ ] **Step 3: Sửa phần React Flow trong `src/index.css`**

Đổi mọi hex cứng sang `rgb(var(--…))`. **GIỮ NGUYÊN mọi `!important`** — comment tại chỗ giải thích nó chống lại `@xyflow/react/dist/style.css` mà Vite phát ra sau file này (cùng specificity, source order muộn hơn). Xoá `!important` là làm hỏng thầm lặng.

```css
.react-flow__controls-button {
  background: rgb(var(--surface-raised)) !important;
  border-bottom: 1px solid rgb(var(--border-subtle)) !important;
  fill: rgb(var(--text-muted)) !important;
}

.react-flow__controls-button:hover {
  background: rgb(var(--surface-hover)) !important;
  fill: rgb(var(--text-strong)) !important;
}

.react-flow__controls-button:disabled {
  fill: rgb(var(--text-faint)) !important;
}

.react-flow__attribution {
  background: transparent;
  color: rgb(var(--text-faint));
}

.react-flow__edge-textbg {
  fill: rgb(var(--surface)) !important;
}

.react-flow__edge-text {
  fill: rgb(var(--accent)) !important;
  font-family: theme('fontFamily.mono');
  font-size: 10px;
}

.react-flow__handle {
  background: rgb(var(--surface)) !important;
  border-color: rgb(var(--border-strong)) !important;
}
```

`.react-flow__handle::after` (vùng chạm 16px) và `.react-flow__controls` box-shadow giữ y nguyên.

- [ ] **Step 4: Sửa scrollbar và focus ring trong `src/index.css`**

```css
* {
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--border-strong)) transparent;
}

*::-webkit-scrollbar-thumb {
  background-color: rgb(var(--border-strong));
  border-radius: 9999px;
}

*::-webkit-scrollbar-thumb:hover {
  background-color: rgb(var(--text-faint));
}
```

Focus ring trong `@layer base`:

```css
    outline: 2px solid rgb(var(--accent));
```

- [ ] **Step 5: Sửa `input[type='range']` trong `src/index.css`**

```css
input[type='range'] {
  appearance: none;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 9999px;
  background: rgb(var(--surface-raised));
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: rgb(var(--accent));
  border: 2px solid rgb(var(--surface));
  cursor: pointer;
  margin-top: 0;
}

input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: rgb(var(--accent));
  border: 2px solid rgb(var(--surface));
  cursor: pointer;
}

input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: rgb(var(--surface-raised));
}
```

Giữ nguyên comment ở trên khối này (nó giải thích tại sao phải vẽ lại cho cả hai engine).

- [ ] **Step 6: Sửa `geometry.ts` và `MessageLayer.tsx`**

`src/shell/ui/canvas/geometry.ts`:

```ts
/**
 * Màu chấm message bay. Là giá trị `fill`/`stroke` của SVG chứ không phải class
 * Tailwind, nên phải tự tham chiếu CSS var. Đổi theo theme là bắt buộc, không
 * phải trang trí: `sky-400` trên nền canvas sáng `#e2e8f0` chỉ đạt tương phản
 * 1.71, dưới ngưỡng 3:1 cho thành phần đồ hoạ phi văn bản.
 */
export const TONE_FILL: Record<string, string> = {
  sky: 'rgb(var(--tone-sky))',
  emerald: 'rgb(var(--tone-emerald))',
  rose: 'rgb(var(--tone-rose))',
  amber: 'rgb(var(--tone-amber))',
}
```

`src/shell/ui/canvas/MessageLayer.tsx`: đổi mọi fallback `?? '#94a3b8'` thành
`?? 'rgb(var(--text-muted))'`, và `stroke="#020617"` thành
`stroke="rgb(var(--canvas))"`.

Nếu `geometry.test.ts` khẳng định giá trị hex cụ thể của `TONE_FILL`, cập nhật assertion sang chuỗi var mới.

- [ ] **Step 7: Áp ba mức độ nổi**

Trong ba layout (`DesktopLayout`, `TabletLayout`, `MobileLayout`) và `Inspector.tsx`:

| Thành phần | Class nền |
|---|---|
| `<div>` gốc của layout | `bg-canvas text-content` |
| `<aside>` sidebar, `<aside>` panel phải, drawer | `bg-surface` |
| `StatePanel` wrapper, `TopBar`, `Transport`, `MobileTabBar` | `bg-surface` |
| `MetricsGrid`, `EventLog`, `CheckpointCard`, `IssuesList`, `HaltedBanner` | `bg-surface-raised border border-edge` |

Đây là thứ tạo chiều sâu mà bản cũ không có (panel và canvas đang cùng `bg-ink-950`).

- [ ] **Step 8: Sửa test bị vỡ**

Chạy: `npm test`
Test nào đỏ vì khẳng định tên class cũ thì cập nhật sang tên mới. **Không** nới lỏng assertion thành `toBeInTheDocument()` — kiểm màu vẫn là kiểm có giá trị.

- [ ] **Step 9: Xác nhận không còn sót**

```bash
grep -rn "ink-[0-9]\|accent-[0-9]\|slate-[0-9]\|sky-[0-9]\|#[0-9a-fA-F]\{6\}" src/shell --include="*.tsx" --include="*.ts" | grep -v "\.test\."
```
Kỳ vọng: **không có kết quả**.

- [ ] **Step 10: Kiểm mắt cả hai theme**

`npm run dev`, bấm nút theme toggle (chưa gắn vào TopBar — tạm render thủ công hoặc dùng DevTools đổi `data-theme` trên `<html>`). Xác nhận không có mảng nào đen-trên-đen hay trắng-trên-trắng.

- [ ] **Step 11: Commit**

```bash
git add src/shell src/index.css
git commit -m "refactor(ui): migrate shell to semantic color tokens and type scale"
```

---

## Task 5: Di trú màu — broker UI

**Files:**
- Modify: `src/brokers/rabbitmq/ui/{nodes,NodeConfig,InFlightPanel}.tsx`, `src/brokers/rabbitmq/ui/toFlow.ts`
- Modify: `src/brokers/rabbitmq/sandbox/{SandboxPanel,ExportDialog}.tsx`
- Modify: `src/brokers/redis/ui/{nodes,NodeConfig,KeyspacePanel}.tsx`, `src/brokers/redis/ui/toFlow.ts`
- Modify: `src/brokers/kafka/ui/{nodes,NodeConfig,LogPanel}.tsx`, `src/brokers/kafka/ui/toFlow.ts`
- Modify: `src/brokers/kafka/sandbox/{SandboxPanel,ExportDialog}.tsx`
- Modify: `src/brokers/rabbitmq/ui/nodes.test.tsx`, `src/brokers/kafka/ui/nodes.test.tsx`

**Interfaces:**
- Consumes: token `role-*`, `surface`, `content`, `edge`, `highlight` từ Task 1.
- Produces: `src/brokers/**` không còn tham chiếu màu numeric nào.

- [ ] **Step 1: Sửa `SHELL` và các node của RabbitMQ**

`src/brokers/rabbitmq/ui/nodes.tsx`:

```ts
const SHELL = 'min-w-[124px] rounded-xl border px-3.5 py-2.5 shadow-node'
```

`HIGHLIGHT` giữ nguyên cơ chế, đổi mỗi màu:

```ts
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-highlight'
```

> Giữ nguyên toàn bộ khối comment ở trên `HIGHLIGHT`. Nó giải thích tại sao dùng `outline` chứ không `ring` (Tailwind ring và box-shadow dùng chung một slot, ring-based highlight sẽ đè mất `selected`). Đó là một bug đã được sửa, không phải ghi chú thừa.

Bốn node, đổi theo đúng mẫu này (ví dụ `PublisherNode`):

```tsx
export function PublisherNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-sky-line bg-role-sky ${selected ? 'ring-2 ring-role-sky-ring' : ''} ${highlightClass(data)}`}
    >
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-sky-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-sky-fg/70">publisher</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

Ánh xạ hue: publisher = `sky`, exchange = `violet`, queue = `emerald`, consumer = `amber`.

`ExchangeNode` **giữ nguyên** `style={{ borderRadius: 999 }}` — hình viên thuốc là dấu hiệu phân biệt exchange với queue.

Subtitle cũ là `text-[10px] text-<hue>-400`; mới là `font-mono text-meta text-role-<hue>-fg/70` — `fg` giảm opacity giữ được quan hệ sáng/tối ở cả hai theme, còn `-400` cứng thì không.

- [ ] **Step 2: Sửa node của Redis và Kafka**

Cùng mẫu. Ánh xạ hue:

| File | Node | hue |
|---|---|---|
| `redis/ui/nodes.tsx` | `ClientNode` | `cyan` |
| | `ServerNode` | `rose` |
| | `ReplicaNode` | `amber` |
| | `SentinelNode` | `violet` |
| `kafka/ui/nodes.tsx` | `BrokerNode` | `blue` |
| | `PartitionNode` | `teal` |
| | `ConsumerGroupNode` | `orange` |
| | `ConsumerNode` | `pink` |
| | `ProducerNode` | `lime` |

`SHELL` và `HIGHLIGHT` trong hai file này cũng đổi y như Step 1 (chúng là hằng riêng của từng file, không chia sẻ).

- [ ] **Step 3: Sửa màu edge trong ba `toFlow.ts`**

`src/brokers/rabbitmq/ui/toFlow.ts` (khoảng dòng 66-69):

```ts
    animated: false,
    style: dashed
      ? { stroke: 'rgb(var(--danger-line, 225 29 72))', strokeDasharray: '6 4' }
      : { stroke: 'rgb(var(--border-strong))' },
```

Vì `--danger-line` không tồn tại (status line là hex thẳng trong config, không phải var), dùng hex trực tiếp cho nhánh `dashed`:

```ts
      ? { stroke: '#e11d48', strokeDasharray: '6 4' }
```

`redis/ui/toFlow.ts` dòng 68 và 93, `kafka/ui/toFlow.ts` dòng 192: đổi
`stroke: '#475569'` thành `stroke: 'rgb(var(--border-strong))'`, giữ nguyên
`strokeDasharray` ở dòng 93 của Redis.

- [ ] **Step 4: Thêm mũi tên cho edge**

Trong cả ba `toFlow.ts`, thêm `markerEnd` vào object edge trả về:

```ts
import { MarkerType } from '@xyflow/react'

// …trong hàm dựng edge:
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgb(var(--border-strong))' },
```

Trong app dạy luồng message, hướng đi là thông tin cốt lõi và bản cũ không vẽ nó.

Nếu `toFlow.test.ts` của broker nào khẳng định shape của edge object bằng `toEqual`, cập nhật expectation để bao gồm `markerEnd`.

- [ ] **Step 5: Sửa panel và sandbox**

```bash
grep -rn "slate-[0-9]\|sky-[0-9]\|ink-[0-9]" src/brokers --include="*.tsx" | grep -v "\.test\." | grep -v "/nodes.tsx"
```

Áp đúng bảng ánh xạ ở Task 4 Step 2 (chúng là chrome panel, không phải node). Hue mang nghĩa vai trò (amber/emerald/violet của từng broker trong `NodeConfig`, `LogPanel`, `KeyspacePanel`, `InFlightPanel`) đổi sang `role-<hue>` tương ứng.

- [ ] **Step 6: Sửa 9 dòng test khoá vào tên màu**

`src/brokers/rabbitmq/ui/nodes.test.tsx` (4 dòng) và `src/brokers/kafka/ui/nodes.test.tsx` (5 dòng) có bảng `it.each` dạng:

```ts
  ['publisher', PublisherNode, 'ring-sky-300', { label: 'p1' }],
```

Đổi chuỗi class thành tên mới: `'ring-role-sky-ring'`, `'ring-role-emerald-ring'`, v.v.

- [ ] **Step 7: Xác nhận không còn sót**

```bash
grep -rn "slate-[0-9]\|sky-[0-9]\|ink-[0-9]\|#[0-9a-fA-F]\{6\}" src/brokers --include="*.tsx" --include="*.ts" | grep -v "\.test\."
```
Kỳ vọng: chỉ còn `#e11d48` ở nhánh `dashed` của RabbitMQ (đã giải thích ở Step 3). Không còn gì khác.

- [ ] **Step 8: Chạy full suite + typecheck**

Chạy: `npm test && npm run typecheck && npm run lint`
Kỳ vọng: PASS cả ba. Snapshot RabbitMQ lessons **không** được đổi — `toNodes` trả data, không trả class. Nếu snapshot đỏ, bạn đã đụng nhầm vào `toNodes`; hoàn tác chỗ đó.

- [ ] **Step 9: Commit**

```bash
git add src/brokers
git commit -m "refactor(brokers): migrate node and panel colors to role tokens, add edge arrows"
```

---

## Task 6: TopBar chung + BrokerSwitcher + LessonSidebar

**Files:**
- Modify: `src/shell/ui/TopBar/TopBar.tsx`, `src/shell/ui/TopBar/TopBar.test.tsx`
- Modify: `src/shell/ui/BrokerSwitcher/BrokerSwitcher.tsx`
- Modify: `src/shell/ui/LessonSidebar/LessonSidebar.tsx`, `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`
- Modify: `src/shell/ui/layouts/DesktopLayout.tsx`
- Modify: `src/shell/ui/MobileTabBar/MobileTabBar.tsx`, `src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`

**Interfaces:**
- Consumes: `<ThemeToggle />` (Task 2), token (Task 1).
- Produces: `TopBar` nhận thêm prop `showBrand?: boolean`; `LessonSidebar` luôn được gọi với `hideBrokerSwitcher`.

- [ ] **Step 1: Viết test cho TopBar mới**

Thêm vào `src/shell/ui/TopBar/TopBar.test.tsx`:

```tsx
it('hiện brand khi showBrand bật', () => {
  render(<TopBar title="Hello world" showBrand />)
  expect(screen.getByText('Broker Visualizer')).toBeInTheDocument()
})

it('không hiện brand mặc định', () => {
  render(<TopBar title="Hello world" />)
  expect(screen.queryByText('Broker Visualizer')).not.toBeInTheDocument()
})

it('luôn có theme toggle', () => {
  render(<TopBar title="Hello world" />)
  expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
})

it('luôn có broker switcher', () => {
  render(<TopBar title="Hello world" />)
  expect(screen.getByTestId('broker-switcher')).toBeInTheDocument()
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/TopBar/TopBar.test.tsx`
Kỳ vọng: FAIL — chưa có brand, chưa có theme toggle.

- [ ] **Step 3: Viết `TopBar.tsx`**

```tsx
import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'
import { ThemeToggle } from '../ThemeToggle/ThemeToggle'
import { MenuIcon } from '../icons'

export function TopBar({
  title,
  onOpenDrawer,
  showBrand = false,
}: {
  title: string
  onOpenDrawer?: () => void
  /** Chỉ desktop. Ở 390px, brand + switcher + tiêu đề + toggle không đủ chỗ, và
   *  tiêu đề bài học là thứ người học cần thấy hơn tên app. */
  showBrand?: boolean
}) {
  return (
    <header
      // `pt-safe` bù cho Dynamic Island / notch khi trang chạy full-bleed.
      className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-surface/95 px-2 pt-safe backdrop-blur"
      data-testid="top-bar"
    >
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          aria-label="Mở danh sách bài học"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-content-muted hover:bg-surface-hover active:bg-surface-hover"
        >
          <MenuIcon />
        </button>
      )}
      {showBrand && (
        <span className="shrink-0 px-1 text-ui font-semibold text-content-strong">Broker Visualizer</span>
      )}
      <BrokerSwitcher />
      <span className="min-w-0 flex-1 truncate text-right text-meta font-medium text-content-muted">{title}</span>
      <ThemeToggle />
    </header>
  )
}
```

- [ ] **Step 4: Viết `BrokerSwitcher.tsx` dạng segmented control**

```tsx
import { BROKERS } from '../../../brokers/registry'
import { useAppStore } from '../../store'

/**
 * The one control that swaps the entire workspace: lessons, canvas, state panel, and
 * sandbox all come from the selected module.
 *
 * Segmented control chứ không phải ba nút rời: đây là một lựa chọn loại trừ trên một
 * trục. Bản cũ chỉ khác nhau màu chữ nên đọc như ba link độc lập.
 */
export function BrokerSwitcher() {
  const brokerId = useAppStore((s) => s.brokerId)
  const setBroker = useAppStore((s) => s.setBroker)

  return (
    <div
      className="flex shrink-0 gap-0.5 rounded-lg bg-surface-raised p-0.5"
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
          className={`min-h-11 rounded-md px-3 text-ui font-medium md:min-h-8 ${
            broker.id === brokerId
              ? 'bg-accent text-accent-fg'
              : 'text-content-muted hover:bg-surface-hover hover:text-content-strong'
          }`}
        >
          {broker.label}
        </button>
      ))}
    </div>
  )
}
```

Lưu ý: bỏ `border-b` và `flex-1` — nó không còn là một dải riêng ở đầu sidebar mà là một control nằm trong `TopBar`.

- [ ] **Step 5: Viết test cho số thứ tự lesson**

Thêm vào `src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`:

```tsx
it('đánh số lesson liên tục toàn broker, không reset theo nhóm', () => {
  render(<LessonSidebar hideBrokerSwitcher />)
  expect(screen.getByText('01')).toBeInTheDocument()
  // RabbitMQ có 17 lesson; số cuối phải là 17, không phải số nhỏ hơn do reset theo nhóm.
  expect(screen.getByText('17')).toBeInTheDocument()
})
```

- [ ] **Step 6: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/LessonSidebar/LessonSidebar.test.tsx`
Kỳ vọng: FAIL — chưa có số nào.

- [ ] **Step 7: Viết `LessonSidebar.tsx`**

Giữ nguyên toàn bộ JSDoc của prop `hideBrokerSwitcher`. Thân component:

```tsx
  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-surface" data-testid="lesson-sidebar">
      {!hideBrokerSwitcher && (
        <div className="border-b border-edge p-2">
          <BrokerSwitcher />
        </div>
      )}
      <div className="flex-1 py-2">
        {broker.lessonGroups.map((group) => (
          <div key={group.id} className="mb-2">
            {/* `sticky`: 17-25 lesson cuộn dài, group header trôi mất là mất ngữ cảnh
                đang ở nhóm nào. */}
            <div className="sticky top-0 z-10 bg-surface/95 px-3 pb-1 pt-2 text-section font-semibold uppercase text-content-faint backdrop-blur">
              {group.label}
            </div>
            {broker.lessons.filter((l) => l.group === group.id).map((lesson) => {
              const active = !sandbox && lesson.id === lessonId
              // Số đếm theo vị trí trong `broker.lessons` chứ không reset theo nhóm:
              // người học nói "bài 12", không nói "bài 3 của nhóm reliability".
              // Suy ra từ mảng, không phải field mới trong `Lesson` — không đụng contract.
              const ordinal = String(broker.lessons.indexOf(lesson) + 1).padStart(2, '0')
              return (
                <button
                  key={lesson.id}
                  onClick={() => setLesson(lesson.id)}
                  className={`mx-2 flex min-h-11 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui md:min-h-0 ${
                    active
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-content-muted hover:bg-surface-hover hover:text-content'
                  }`}
                >
                  <span className="w-6 shrink-0 font-mono text-meta text-content-faint">{ordinal}</span>
                  <span className="min-w-0 flex-1 leading-snug">{lesson.title}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {broker.sandbox && (
        <button
          onClick={openSandbox}
          className={`flex min-h-11 shrink-0 items-center gap-2 border-t border-edge px-3 py-2 text-left text-ui font-medium md:min-h-0 ${
            sandbox ? 'bg-accent-soft text-accent' : 'text-content-muted hover:bg-surface-hover hover:text-content'
          }`}
          data-testid="open-sandbox"
        >
          <LayoutGridIcon className="h-4 w-4" />
          Sandbox
        </button>
      )}
    </nav>
  )
```

Thêm `LayoutGridIcon` vào import từ `../icons`.

- [ ] **Step 8: Gắn TopBar vào DesktopLayout**

`src/shell/ui/layouts/DesktopLayout.tsx` — bọc toàn bộ trong một cột dọc, đặt `TopBar` lên trên:

```tsx
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function DesktopLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-canvas text-content">
      <TopBar title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')} showBrand />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[272px] shrink-0 border-r border-edge bg-surface">
          <LessonSidebar hideBrokerSwitcher />
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
          <div className="border-t border-edge bg-surface">
            <StatePanel state={state} />
          </div>
          <Transport durationMs={durationMs} onStep={onStep} />
        </main>
        <aside className="w-96 shrink-0 border-l border-edge bg-surface p-3.5">
          <SidePanel {...props} />
        </aside>
      </div>
    </div>
  )
}
```

> `<Transport>` ở đây **chưa** truyền `marks` — prop đó do Task 8 thêm vào cả `Transport` lẫn `LayoutProps`. Truyền sớm sẽ làm typecheck đỏ. Task 8 Step 5 quay lại thêm `marks={props.marks}` vào cả ba layout.

`overflow-y-auto` bị bỏ khỏi `<aside>` phải: Task 7 chuyển việc cuộn xuống hai vùng con của `Inspector`.

- [ ] **Step 9: Đổi nhãn tab thứ ba ở mobile**

`src/shell/ui/MobileTabBar/MobileTabBar.tsx`:

```ts
const TABS: { id: MobilePane; label: string; Icon: typeof BookIcon }[] = [
  { id: 'lessons', label: 'Bài học', Icon: BookIcon },
  { id: 'canvas', label: 'Canvas', Icon: LayoutGridIcon },
  // Nhãn là "Diễn giải" chứ không phải "Trạng thái": pane này chứa narrative — nội
  // dung chính của bài học. Chỉ số và nhật ký nằm trong tab strip con của Inspector.
  // Định danh `'state'` trong store giữ nguyên; đổi nó chỉ làm hỏng mọi
  // `setMobilePane('state')` mà không đem lại gì.
  { id: 'state', label: 'Diễn giải', Icon: GaugeIcon },
]
```

Cập nhật `MobileTabBar.test.tsx` nếu nó khẳng định chuỗi "Trạng thái".

- [ ] **Step 10: Chạy full suite**

Chạy: `npm test && npm run typecheck`
Sửa mọi test đỏ do đổi cấu trúc. Đặc biệt `App.test.tsx` có thể khẳng định desktop **không** có `top-bar` — assertion đó giờ sai, đảo lại.

- [ ] **Step 11: Commit**

```bash
git add src/shell/ui
git commit -m "feat(ui): unify TopBar across breakpoints, numbered lesson list, segmented broker switcher"
```

---

## Task 7: Inspector hai vùng + tab strip

**Files:**
- Create: `src/shell/ui/Inspector/InspectorTabs.tsx`
- Create: `src/shell/ui/Inspector/InspectorTabs.test.tsx`
- Modify: `src/shell/ui/Inspector/Inspector.tsx`
- Modify: `src/shell/ui/layouts/TabletLayout.tsx`, `src/shell/ui/layouts/MobileLayout.tsx`

**Interfaces:**
- Consumes: `MetricsGrid`, `EventLog` (đã export sẵn từ `Inspector.tsx`), `broker.NodeConfig`, `broker.metrics`, store `selectedNodeId`.
- Produces: `<InspectorTabs broker lesson state />`.

- [ ] **Step 1: Viết test**

Tạo `src/shell/ui/Inspector/InspectorTabs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { getBroker } from '../../../brokers/registry'
import { useAppStore } from '../../store'
import { InspectorTabs } from './InspectorTabs'

const broker = getBroker('rabbitmq')
const lesson = broker.lessons[0]!
// `createSimulation` nhận một object options, không phải danh sách tham số vị trí.
// Chữ ký đầy đủ ở `src/brokers/types.ts:13`.
const state = broker
  .createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  .snapshot()

function renderTabs() {
  return render(<InspectorTabs broker={broker} lesson={lesson} state={state} />)
}

describe('InspectorTabs', () => {
  beforeEach(() => {
    useAppStore.getState().selectNode(undefined)
  })

  it('mặc định mở tab Chỉ số', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Chỉ số' })).toHaveAttribute('aria-selected', 'true')
  })

  it('tab Cấu hình mang aria-disabled khi chưa chọn node', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Cấu hình' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('chọn node thì tự chuyển sang tab Cấu hình', () => {
    const { rerender } = renderTabs()
    useAppStore.getState().selectNode('p1')
    rerender(<InspectorTabs broker={broker} lesson={lesson} state={state} />)
    expect(screen.getByRole('tab', { name: 'Cấu hình' })).toHaveAttribute('aria-selected', 'true')
  })

  it('bỏ chọn node thì quay về tab Chỉ số', () => {
    const { rerender } = renderTabs()
    useAppStore.getState().selectNode('p1')
    rerender(<InspectorTabs broker={broker} lesson={lesson} state={state} />)
    useAppStore.getState().selectNode(undefined)
    rerender(<InspectorTabs broker={broker} lesson={lesson} state={state} />)
    expect(screen.getByRole('tab', { name: 'Chỉ số' })).toHaveAttribute('aria-selected', 'true')
  })

  it('bấm tab Nhật ký thì đổi panel', async () => {
    const user = userEvent.setup()
    renderTabs()
    await user.click(screen.getByRole('tab', { name: 'Nhật ký' }))
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true')
  })

  it('mũi tên phải chuyển sang tab kế', async () => {
    const user = userEvent.setup()
    renderTabs()
    screen.getByRole('tab', { name: 'Chỉ số' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true')
  })
})
```

> `lesson.seed` và `lesson.failures` đều là field có sẵn trên `Lesson`; `failures` là optional nên truyền `undefined` cũng hợp lệ.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/Inspector/InspectorTabs.test.tsx`
Kỳ vọng: FAIL — không resolve được `./InspectorTabs`.

- [ ] **Step 3: Viết `InspectorTabs.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { KernelState } from '../../kernel/types'
import type { Lesson } from '../../lesson/types'
import { useAppStore } from '../../store'
import { EventLog, MetricsGrid } from './Inspector'

type TabId = 'metrics' | 'journal' | 'config'

const TABS: { id: TabId; label: string }[] = [
  { id: 'metrics', label: 'Chỉ số' },
  { id: 'journal', label: 'Nhật ký' },
  { id: 'config', label: 'Cấu hình' },
]

/**
 * Ba mặt dữ liệu của một lượt chạy, trước đây xếp dọc trong cùng một vùng cuộn với
 * narrative. Nhật ký khi đó luôn nằm dưới đáy màn — mà nó là thứ đổi mỗi tick.
 *
 * Việc "chọn node làm biến mất bảng chỉ số" ở bản cũ là một lần chuyển chế độ ngầm.
 * Tab hoá làm nó hiện rõ, và cho phép xem lại chỉ số mà không phải bỏ chọn node.
 */
export function InspectorTabs({
  broker,
  lesson,
  state,
}: {
  broker: AnyBrokerModule
  lesson: Lesson<any, any>
  state: KernelState
}) {
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const [tab, setTab] = useState<TabId>('metrics')
  const { NodeConfig } = broker

  // Chọn node trên canvas là một hành động ở nơi khác trên màn hình; nếu tab không
  // tự theo, cấu hình node hiện ra ở một chỗ người dùng đang không nhìn.
  useEffect(() => {
    setTab(selectedNodeId ? 'config' : 'metrics')
  }, [selectedNodeId])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = TABS.findIndex((t) => t.id === tab)
    const next = event.key === 'ArrowRight' ? index + 1 : index - 1
    const target = TABS[(next + TABS.length) % TABS.length]
    if (target) setTab(target.id)
  }

  return (
    <div className="flex min-h-0 shrink-0 basis-2/5 flex-col border-t border-edge pt-2">
      <div role="tablist" aria-label="Dữ liệu mô phỏng" onKeyDown={onKeyDown} className="flex shrink-0 gap-0.5">
        {TABS.map(({ id, label }) => {
          const disabled = id === 'config' && !selectedNodeId
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              // `aria-disabled` chứ không phải `disabled`: nút `disabled` biến mất khỏi
              // thứ tự tab, người dùng bàn phím không biết nó tồn tại.
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && setTab(id)}
              className={`rounded-md px-2.5 py-1 text-meta font-medium ${
                tab === id
                  ? 'bg-accent-soft text-accent'
                  : disabled
                    ? 'text-content-faint/50'
                    : 'text-content-muted hover:bg-surface-hover hover:text-content'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="mt-1.5 min-h-0 flex-1 overflow-y-auto">
        {tab === 'metrics' && <MetricsGrid metrics={broker.metrics(state)} />}
        {tab === 'journal' && <EventLog journal={state.journal} />}
        {tab === 'config' && selectedNodeId && (
          <NodeConfig lesson={lesson} state={state} nodeId={selectedNodeId} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Chạy: `npx vitest run src/shell/ui/Inspector/InspectorTabs.test.tsx`
Kỳ vọng: PASS, 6 test.

- [ ] **Step 5: Viết lại `Inspector.tsx` thành hai vùng**

Giữ nguyên `IssuesList`, `HaltedBanner`, `MetricsGrid`, `EventLog` (chúng được `SandboxPanel` của broker dùng chung — xoá là làm hỏng sandbox). Chỉ đổi thân `Inspector`:

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      {/* Vùng 1: narrative, cuộn riêng. Tách khỏi vùng dữ liệu bên dưới để đọc
          narrative không làm mất dấu nhật ký đang chạy. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <section className="max-w-[68ch]">
          <div className="flex items-start justify-between gap-2">
            <h2 className="mb-1 text-ui font-semibold leading-snug text-content-strong">
              <MarkdownInline text={step?.title ?? lesson.title} />
            </h2>
            {ExportDialog && (
              <button
                onClick={() => setExportOpen(true)}
                data-testid="export-button"
                className="min-h-11 shrink-0 rounded-lg border border-edge-strong px-2.5 py-1 text-meta font-medium text-content hover:bg-surface-hover active:bg-surface-hover md:min-h-0"
              >
                Xuất code
              </button>
            )}
          </div>
          <Markdown text={step?.body ?? lesson.summary} />
        </section>

        {exportOpen && ExportDialog && (
          <ExportDialog topology={lesson.topology} onClose={() => setExportOpen(false)} />
        )}

        {/* Lesson-only: the sandbox has no narrative and no checkpoints, so SandboxPanel
            deliberately does not render this the way it shares IssuesList/MetricsGrid. */}
        <CheckpointSection lessonId={lesson.id} checkpoints={lesson.checkpoints} now={state.now} />

        <IssuesList issues={issues} issueText={broker.issueText} />

        <HaltedBanner halted={state.halted} />
      </div>

      {/* Vùng 2: chỉ số / nhật ký / cấu hình, cuộn riêng, chiều cao cố định. */}
      <InspectorTabs broker={broker} lesson={lesson} state={state} />
    </div>
  )
```

Bỏ import `activeStepIndex`? **Không** — `step` vẫn dùng nó. Bỏ `selectedNodeId` khỏi `Inspector` (đã chuyển sang `InspectorTabs`). Thêm `import { InspectorTabs } from './InspectorTabs'`.

`Markdown` cần đổi cỡ chữ thân bài sang `text-narrative` — kiểm `src/shell/ui/Inspector/Markdown.tsx` và đổi class cỡ chữ ở đó.

⚠️ Vòng import: `InspectorTabs.tsx` import `MetricsGrid`/`EventLog` từ `Inspector.tsx`, và `Inspector.tsx` import `InspectorTabs`. ES module xử lý được vòng này vì cả hai chỉ dùng nhau lúc render, không lúc khởi tạo module. Nếu chạy lên gặp `undefined is not a function`, tách `MetricsGrid`/`EventLog` ra file `src/shell/ui/Inspector/panels.tsx` và cho cả hai import từ đó — nhớ cập nhật cả `SandboxPanel` của RabbitMQ và Kafka.

- [ ] **Step 6: Bỏ `overflow-y-auto` khỏi aside ở Tablet và Mobile**

`TabletLayout.tsx`: `<aside className="w-80 shrink-0 border-l border-edge bg-surface p-3">` (bỏ `overflow-y-auto`, `w-72` → `w-80`).

`MobileLayout.tsx`, pane `'state'`: bỏ `overflow-y-auto` ở div bọc ngoài, để `Inspector` tự quản lý hai vùng cuộn của nó:

```tsx
        {pane === 'state' && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-edge">
              <StatePanel state={state} />
            </div>
            <div className="min-h-0 flex-1 p-3">
              <SidePanel {...props} />
            </div>
          </div>
        )}
```

- [ ] **Step 7: Chạy full suite**

Chạy: `npm test && npm run typecheck && npm run lint`
Sửa test đỏ. `App.test.tsx` có thể khẳng định nhật ký hiện mặc định — giờ nó nằm sau tab "Nhật ký", cập nhật assertion.

- [ ] **Step 8: Commit**

```bash
git add src/shell/ui
git commit -m "feat(ui): split Inspector into narrative and tabbed data regions"
```

---

## Task 8: Transport — mốc sự kiện và track tô màu

**Files:**
- Create: `src/shell/ui/Transport/ScrubTrack.tsx`
- Create: `src/shell/ui/Transport/ScrubTrack.test.tsx`
- Modify: `src/shell/ui/Transport/Transport.tsx`, `src/shell/ui/Transport/Transport.test.tsx`
- Modify: `src/shell/ui/layouts/types.ts`, `src/shell/ui/App.tsx`, ba file layout

**Interfaces:**
- Consumes: token (Task 1).
- Produces:
  - `<ScrubTrack value max marks onSeek />` với `marks: number[]`
  - `LayoutProps.marks: number[]`
  - `Transport` nhận thêm prop `marks: number[]`

- [ ] **Step 1: Viết test cho `ScrubTrack`**

Tạo `src/shell/ui/Transport/ScrubTrack.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrubTrack } from './ScrubTrack'

describe('ScrubTrack', () => {
  it('vẽ một vạch cho mỗi mốc', () => {
    render(<ScrubTrack value={0} max={10000} marks={[1000, 2000, 5000]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(3)
  })

  it('gộp mốc trùng thời điểm', () => {
    render(<ScrubTrack value={0} max={10000} marks={[1000, 1000, 1000, 4000]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(2)
  })

  it('bỏ mốc nằm ngoài khoảng', () => {
    render(<ScrubTrack value={0} max={10000} marks={[-5, 3000, 99999]} onSeek={vi.fn()} />)
    expect(screen.getAllByTestId('scrub-mark')).toHaveLength(1)
  })

  it('không vẽ vạch nào khi journal rỗng', () => {
    render(<ScrubTrack value={0} max={10000} marks={[]} onSeek={vi.fn()} />)
    expect(screen.queryAllByTestId('scrub-mark')).toHaveLength(0)
  })

  it('đặt vạch đúng tỉ lệ phần trăm', () => {
    render(<ScrubTrack value={0} max={10000} marks={[2500]} onSeek={vi.fn()} />)
    expect(screen.getByTestId('scrub-mark')).toHaveStyle({ left: '25%' })
  })

  it('max bằng 0 không làm vỡ (chia cho 0)', () => {
    render(<ScrubTrack value={0} max={0} marks={[0]} onSeek={vi.fn()} />)
    expect(screen.queryAllByTestId('scrub-mark')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/Transport/ScrubTrack.test.tsx`
Kỳ vọng: FAIL — không resolve được `./ScrubTrack`.

- [ ] **Step 3: Viết `ScrubTrack.tsx`**

```tsx
/**
 * Thanh tua. `<input type="range">` trơn của trình duyệt không có hai thứ mà một
 * thanh tua mô phỏng cần: track tô phần đã chạy, và mốc cho biết ở đâu có sự kiện.
 * Cả hai vẽ bằng lớp phủ phía sau input thật — input vẫn là thứ nhận chuột, bàn
 * phím và screen reader, nên không mất khả năng truy cập nào.
 */
export function ScrubTrack({
  value,
  max,
  marks,
  onSeek,
  className = '',
}: {
  value: number
  max: number
  /** Mốc thời gian ảo có sự kiện, đơn vị ms. Trùng nhau và ngoài khoảng đều bị lọc. */
  marks: number[]
  onSeek(virtualMs: number): void
  className?: string
}) {
  // `max <= 0` xảy ra ở lesson chưa có `durationMs` hợp lệ; chia cho 0 sẽ đẻ ra
  // `Infinity%` và React Flow… không, đơn giản là vạch bay ra ngoài màn hình.
  const percents =
    max > 0
      ? [...new Set(marks.filter((at) => at >= 0 && at <= max).map((at) => (at / max) * 100))]
      : []
  const progress = max > 0 ? (Math.min(value, max) / max) * 100 : 0

  return (
    <div className={`relative flex min-w-0 items-center ${className}`}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2">
        <div className="h-full rounded-full bg-surface-raised" />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${progress}%` }}
        />
        {percents.map((percent) => (
          <span
            key={percent}
            data-testid="scrub-mark"
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-content-faint"
            style={{ left: `${percent}%` }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(value, max)}
        onChange={(e) => onSeek(Number(e.target.value))}
        // Nền trong suốt: track thật đã vẽ ở lớp phủ bên trên.
        className="relative w-full bg-transparent"
        aria-label="scrub"
      />
    </div>
  )
}
```

⚠️ `src/index.css` đang set `background` cho `input[type='range']`. Class `bg-transparent` ở đây thắng được vì Tailwind utility có cùng specificity nhưng nằm ở `@tailwind utilities` — phát ra **sau** rule trần trong file. Xác nhận bằng mắt ở Step 8; nếu không thắng, đổi rule trong `index.css` thành `background: transparent` và bỏ class.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Chạy: `npx vitest run src/shell/ui/Transport/ScrubTrack.test.tsx`
Kỳ vọng: PASS, 6 test.

- [ ] **Step 5: Nối `marks` từ `App` xuống**

`src/shell/ui/layouts/types.ts`, thêm vào `LayoutProps`:

```ts
  /** Mốc thời gian ảo có sự kiện, cho thanh tua. Tính ở `App` từ `state.journal`
   *  — `Transport` vẫn là component thuần theo prop, không đọc store để lấy journal. */
  marks: number[]
```

`src/shell/ui/App.tsx`, thêm trước `const props: LayoutProps = {`:

```ts
  const marks = state.journal.map((entry) => entry.at)
```

và thêm `marks,` vào object `props`.

Ba layout truyền `marks={props.marks}` xuống `<Transport>`.

- [ ] **Step 6: Viết lại `Transport.tsx`**

Giữ nguyên JSDoc của prop `compact`. Đổi chữ ký và thân:

```tsx
export function Transport({
  durationMs,
  onStep,
  marks,
  compact = false,
}: {
  durationMs: number
  onStep(): void
  marks: number[]
  compact?: boolean
}) {
```

Thay khối `<input type="range">` + `<span>` thời gian bằng:

```tsx
      <ScrubTrack
        value={virtualTime}
        max={max}
        marks={marks}
        onSeek={seek}
        className={`${compact ? 'min-w-0 ' : ''}flex-1`}
      />
      <span
        className={`${compact ? 'w-16' : 'w-24'} shrink-0 text-right font-mono text-meta text-content-muted`}
      >
        {(virtualTime / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s
      </span>
```

Đổi nút play sang `rounded-full`, và toàn bộ class màu sang token:

```tsx
        className={`flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-ui font-medium text-accent-fg shadow-sm hover:bg-accent-hover ${tap}`}
```

Wrapper ngoài cùng: `border-t border-edge bg-surface/95`.

- [ ] **Step 7: Cập nhật `Transport.test.tsx`**

Mọi lời gọi `render(<Transport … />)` giờ phải truyền `marks`. Thêm `marks={[]}` vào những test không quan tâm tới mốc, và thêm một test mới:

```tsx
it('hiện cả thời gian hiện tại lẫn tổng thời lượng', () => {
  render(<Transport durationMs={12000} onStep={vi.fn()} marks={[]} />)
  expect(screen.getByText('0.0s / 12.0s')).toBeInTheDocument()
})
```

- [ ] **Step 8: Chạy full suite + kiểm mắt**

Chạy: `npm test && npm run typecheck && npm run lint`
Chạy: `npm run dev`, xác nhận thanh tua có vạch mốc và phần đã chạy được tô màu ở **cả hai theme**.

- [ ] **Step 9: Commit**

```bash
git add src/shell/ui
git commit -m "feat(ui): add event marks and progress fill to the transport scrubber"
```

---

## Task 9: Canvas — sàn zoom, minimap, node shell

**Files:**
- Modify: `src/shell/ui/CanvasView/CanvasView.tsx`, `src/shell/ui/CanvasView/CanvasView.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile` từ `../useMediaQuery`, token từ Task 1.
- Produces: `export const READABLE_ZOOM = 0.75`.

- [ ] **Step 1: Viết test cho hằng số**

Thêm vào `src/shell/ui/CanvasView/CanvasView.test.tsx`:

```tsx
import { FIT_VIEW_OPTIONS, MIN_ZOOM, READABLE_ZOOM } from './CanvasView'

it('fitView không co xuống dưới ngưỡng đọc được', () => {
  // jsdom không có layout thật nên không kiểm được zoom thực tế; khẳng định cấu hình
  // là thứ duy nhất kiểm được ở đây, và nó chính là thứ hay bị sửa nhầm.
  expect(FIT_VIEW_OPTIONS.minZoom).toBe(READABLE_ZOOM)
  expect(READABLE_ZOOM).toBeGreaterThan(MIN_ZOOM)
})

it('người dùng vẫn tự zoom xa hơn ngưỡng fitView được', () => {
  expect(MIN_ZOOM).toBe(0.25)
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `npx vitest run src/shell/ui/CanvasView/CanvasView.test.tsx`
Kỳ vọng: FAIL — `READABLE_ZOOM` chưa export.

- [ ] **Step 3: Sửa hằng số zoom**

Trong `src/shell/ui/CanvasView/CanvasView.tsx`, thay khối hằng số (giữ nguyên comment tiếng Việt đang có cho `MIN_ZOOM`):

```ts
/**
 * React Flow mặc định `minZoom` là 0.5. Một cluster ba broker sáu partition không
 * lọt vào bề ngang 393px ở mức đó, nên người dùng iPhone chỉ thấy một góc canvas
 * và không zoom ra xa hơn được.
 */
export const MIN_ZOOM = 0.25

/**
 * Sàn zoom cho `fitView`. Không có nó, `fitView` co bao nhiêu cũng được miễn vừa
 * khung: ở 390px, topology bốn node bị co về ~0.4, chữ 13px hiển thị còn ~5px và
 * không ai đọc nổi. Thà tràn khung phải pan còn hơn vừa khung mà mù.
 *
 * Khác `MIN_ZOOM`: đây chỉ chặn `fitView`. Người dùng vẫn tự zoom xa tới 0.25 được.
 */
export const READABLE_ZOOM = 0.75

/** Chừa mép để node ngoài cùng không dính sát viền — hằng số vì cả `fitView` lúc
 *  mount lẫn hai effect fit lại bên dưới đều phải dùng đúng một giá trị. */
export const FIT_VIEW_OPTIONS = {
  padding: 0.15,
  minZoom: READABLE_ZOOM,
  // Lesson hai node không được phóng to lố tới mức mỗi node chiếm nửa màn.
  maxZoom: 1.2,
}
```

- [ ] **Step 4: Thêm MiniMap và fade mép**

Thêm import:

```ts
import { Background, Controls, MiniMap, ReactFlow, type Connection, type Node, type NodeChange } from '@xyflow/react'
import { useIsMobile } from '../useMediaQuery'
```

Trong thân component, sau các `useCallback` hiện có:

```ts
  // Sàn zoom ở trên cố ý cho phép topology tràn khung. Người dùng phải biết còn nội
  // dung ngoài mép, nếu không họ tưởng đó là tất cả.
  const isMobile = useIsMobile()
```

Trong JSX, sau `<Controls showInteractive={false} />`:

```tsx
        {!isMobile && (
          <MiniMap
            // `aria-hidden`: nó nhân bản canvas, screen reader đọc hai lần là nhiễu.
            // Không đặt ở mobile — 390px không có chỗ, và fade mép làm đúng việc đó rồi.
            aria-hidden
            pannable
            zoomable
            className="!bg-surface-raised"
            maskColor="rgb(var(--canvas) / 0.6)"
            nodeColor={() => 'rgb(var(--border-strong))'}
          />
        )}
```

Sau `<MessageLayer … />`, thêm fade cho mobile:

```tsx
      {isMobile && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-canvas to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-canvas to-transparent"
          />
        </>
      )}
```

- [ ] **Step 5: Đổi màu `<Background>`**

```tsx
        <Background color="rgb(var(--border-subtle))" gap={24} />
```

- [ ] **Step 6: Chạy test**

Chạy: `npx vitest run src/shell/ui/CanvasView && npm run typecheck`
Kỳ vọng: PASS. Nếu test cũ mock `@xyflow/react` mà thiếu `MiniMap`, thêm nó vào mock.

- [ ] **Step 7: Kiểm mắt ở mobile**

`npm run dev`, DevTools ở 390×844, xác nhận node đọc được và có thể pan ngang, có fade hai mép. Ở 1440 xác nhận minimap hiện góc dưới-phải và không đè lên `Controls`.

- [ ] **Step 8: Chạy full suite**

Chạy: `npm test && npm run lint`
Kỳ vọng: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shell/ui/CanvasView
git commit -m "feat(ui): floor fitView at a readable zoom, add minimap and edge fades"
```

---

## Task 10: Audit tương phản + kiểm thị giác

**Files:**
- Create: `scripts/contrast-audit.mjs`
- Modify: `src/index.css` (chỉ nếu audit fail)
- Modify: `README.md`

**Interfaces:**
- Consumes: giá trị token từ Task 1.
- Produces: bằng chứng đo được rằng mọi cặp chữ/nền đạt WCAG AA.

- [ ] **Step 1: Viết script audit**

Tạo `scripts/contrast-audit.mjs`:

```js
/**
 * Kiểm tương phản mọi cặp chữ/nền ở cả hai theme. Chạy tay:
 *   node scripts/contrast-audit.mjs
 *
 * Không phải test tự động vì nó đọc bảng giá trị chép tay dưới đây chứ không parse
 * CSS — một test đọc chính giá trị mình khẳng định thì không kiểm được gì. Đây là
 * công cụ dùng khi đổi token, và bằng chứng đính kèm khi review.
 */

const THEMES = {
  light: {
    canvas: [226, 232, 240],
    surface: [255, 255, 255],
    'surface-raised': [248, 250, 252],
    'surface-hover': [241, 245, 249],
    'text-strong': [15, 23, 42],
    'text-body': [51, 65, 85],
    'text-muted': [100, 116, 139],
    'text-faint': [100, 116, 139],
    accent: [2, 132, 199],
    'accent-soft': [224, 242, 254],
    'accent-fg': [255, 255, 255],
    'ok-bg': [236, 253, 245],
    'ok-fg': [6, 95, 70],
    'danger-bg': [255, 241, 242],
    'danger-fg': [159, 18, 57],
    'warn-bg': [255, 251, 235],
    'warn-fg': [146, 64, 14],
  },
  dark: {
    canvas: [2, 6, 23],
    surface: [11, 18, 32],
    'surface-raised': [19, 28, 46],
    'surface-hover': [30, 41, 59],
    'text-strong': [241, 245, 249],
    'text-body': [203, 213, 225],
    'text-muted': [148, 163, 184],
    'text-faint': [148, 163, 184],
    accent: [56, 189, 248],
    'accent-soft': [12, 74, 110],
    'accent-fg': [2, 6, 23],
    'ok-bg': [2, 44, 34],
    'ok-fg': [167, 243, 208],
    'danger-bg': [76, 5, 25],
    'danger-fg': [254, 205, 211],
    'warn-bg': [69, 26, 3],
    'warn-fg': [253, 230, 138],
  },
}

const SURFACES = ['canvas', 'surface', 'surface-raised', 'surface-hover']
const FOREGROUNDS = ['text-strong', 'text-body', 'text-muted', 'text-faint', 'accent']
const STATUS = [
  ['ok-fg', 'ok-bg'],
  ['danger-fg', 'danger-bg'],
  ['warn-fg', 'warn-bg'],
  ['accent', 'accent-soft'],
  ['accent-fg', 'accent'],
]

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

let failures = 0
for (const [name, tokens] of Object.entries(THEMES)) {
  console.log(`\n=== ${name} ===`)
  const pairs = [
    ...FOREGROUNDS.flatMap((fg) => SURFACES.map((bg) => [fg, bg])),
    ...STATUS,
  ]
  for (const [fg, bg] of pairs) {
    const value = ratio(tokens[fg], tokens[bg])
    const pass = value >= 4.5
    if (!pass) failures++
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${value.toFixed(2).padStart(6)}  ${fg} trên ${bg}`)
  }
}

console.log(`\n${failures} cặp không đạt 4.5:1`)
process.exit(failures > 0 ? 1 : 0)
```

- [ ] **Step 2: Chạy audit**

Chạy: `node scripts/contrast-audit.mjs`

Đọc kỹ output. Một số cặp **được phép** FAIL và phải bỏ khỏi danh sách kiểm nếu chúng không tồn tại thật trong giao diện — ví dụ `text-faint` trên `canvas` nếu không component nào đặt chữ faint thẳng lên nền canvas. Trước khi nới, **kiểm bằng grep** xem cặp đó có xuất hiện thật không:

```bash
grep -rn "text-content-faint" src --include="*.tsx" | grep -v "\.test\."
```

Cặp nào FAIL **và** tồn tại thật thì sửa giá trị token trong `src/index.css` (đẩy chữ sáng/tối hơn, KHÔNG đẩy cỡ chữ) rồi cập nhật cả bảng trong script cho khớp. Lặp tới khi exit 0.

- [ ] **Step 3: Chụp ảnh kiểm thị giác**

`npm run dev`, rồi với mỗi kích thước trong `375×667`, `390×844`, `768×1024`, `1024×768`, `1440×900`, và với mỗi theme (`light`, `dark` — đổi bằng nút toggle), kiểm:

- Không mảng nào chữ-trùng-nền.
- Node canvas đọc được, không bị cắt.
- Không cuộn ngang ở `<body>`.
- Tap target ở mobile ≥ 44px (đo bằng DevTools).
- Focus ring hiện rõ khi Tab qua từng control, ở **cả hai** theme.
- `prefers-reduced-motion: reduce` (DevTools → Rendering) không làm vỡ bố cục.

Ghi lại bất kỳ chỗ nào hỏng và sửa trước khi đi tiếp.

- [ ] **Step 4: Cập nhật README**

Trong `README.md`, phần "Màn hình nhỏ", thêm một đoạn về theme:

```markdown
## Giao diện sáng/tối

Toàn bộ màu đi qua CSS variable đặt trên `<html data-theme>`; `tailwind.config.js`
chỉ bọc chúng thành tên ngữ nghĩa (`surface`, `content`, `edge`, `accent`,
`role-*`). Không có hex nào trong component. Đổi bảng màu là sửa `src/index.css`,
không phải grep 20 file.

Theme lần đầu theo `prefers-color-scheme`; bấm nút ở `TopBar` thì lựa chọn được
lưu vào `localStorage` và thắng. Script đồng bộ trong `<head>` của `index.html`
set `data-theme` **trước khi React mount** — thiếu nó thì trang chớp một frame ở
theme sai.

Kiểm tương phản: `node scripts/contrast-audit.mjs` (phải exit 0).
```

Cập nhật số test trong phần "Kiểm thử và build" cho khớp output thật của `npm test`.

- [ ] **Step 5: Chạy toàn bộ cổng chất lượng**

```bash
npm test && npm run typecheck && npm run lint && npm run build && node scripts/contrast-audit.mjs
```
Kỳ vọng: cả năm exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/contrast-audit.mjs README.md src/index.css
git commit -m "test(ui): add contrast audit script and document the theme system"
```

---

## Ngoài scope

Không làm, kể cả khi thấy tiện tay:

- Tiến độ học / đánh dấu lesson đã hoàn thành.
- Command palette, onboarding, trang chủ lesson.
- Phím tắt cho Transport (đã cân nhắc ở giai đoạn thiết kế, người dùng không chọn).
- Bất kỳ thay đổi nào trong `src/shell/kernel/**` hay `src/brokers/*/engine/**`.
- Sửa lesson copy.
- Đổi `BrokerModule` contract hay shape của `Lesson`.
- Đổi logic Sandbox — `SandboxPanel` và `ExportDialog` chỉ nhận di trú token ở Task 5.
