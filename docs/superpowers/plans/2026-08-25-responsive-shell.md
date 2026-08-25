# Responsive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toàn bộ shell (canvas, sidebar, inspector, transport) dùng được xuống viewport 393×852 (iPhone 15 / 15 Pro) mà không vỡ layout, áp cho cả RabbitMQ lẫn Redis.

**Architecture:** `App` tính sẵn mọi dữ liệu rồi chọn một trong ba layout component (`DesktopLayout` / `TabletLayout` / `MobileLayout`) dựa trên hai hook media query gọi vô điều kiện. Mobile hiển thị đúng một pane tại một thời điểm, chọn bằng tab bar dưới đáy; trạng thái pane sống trong Zustand store để test đặt được. Desktop giữ nguyên 100% layout hiện tại.

**Tech Stack:** React 18 + TypeScript strict, Zustand, Tailwind CSS, `@xyflow/react`, Vitest + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-responsive-and-kafka-design.md` (Phần A)

## Global Constraints

- Breakpoint dùng đúng mặc định Tailwind, **không** sửa `tailwind.config.js`: mobile `< 768px`, tablet `768–1023px` (`md`), desktop `≥ 1024px` (`lg`).
- Layout desktop (`≥ 1024px`) phải giống hệt hiện tại — không đổi một pixel.
- Mọi giá trị cứng trong layout mobile phải chịu được 375px (iPhone SE/mini), không chỉ 393px.
- Tap target ở mobile tối thiểu 44px → class `min-h-11` (Tailwind `11` = `2.75rem` = 44px).
- Typecheck **bắt buộc** chạy `npm run typecheck` (`tsc -b`). Không bao giờ chạy `npx tsc --noEmit` — root `tsconfig.json` là project-references với `"files": []` nên nó compile 0 file và luôn exit 0.
- Strict TS đang bật: `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Import chỉ dùng cho type phải viết `import type`.
- Không test nào được sửa để "cho qua" — `matchMedia` stub mặc định trả desktop nên mọi test hiện có phải tiếp tục xanh nguyên trạng.
- Copy hướng tới người đọc viết tiếng Việt có dấu (`Bài học`, `Canvas`, `Trạng thái`, `Chạy lại`, `Bước`).
- Comment trong repo này giải thích **tại sao**, và thường ghi lại một bug đã sửa. Giữ nguyên comment cũ, viết comment mới cùng mật độ.

---

## File Structure

**Tạo mới:**
- `src/test/viewport.ts` — helper test: cài `window.matchMedia` giả, đổi chiều rộng viewport trong test.
- `src/shell/ui/useMediaQuery.ts` — hook `useMediaQuery` + `useIsMobile` + `useIsTablet`.
- `src/shell/ui/useMediaQuery.test.ts`
- `src/shell/ui/MobileTabBar/MobileTabBar.tsx` + `.test.tsx`
- `src/shell/ui/TopBar/TopBar.tsx` + `.test.tsx`
- `src/shell/ui/layouts/types.ts` — `LayoutProps` dùng chung cho ba layout.
- `src/shell/ui/layouts/SidePanel.tsx` — chọn `Inspector` hay `SandboxPanel`, dùng chung ba layout.
- `src/shell/ui/layouts/DesktopLayout.tsx`
- `src/shell/ui/layouts/TabletLayout.tsx`
- `src/shell/ui/layouts/MobileLayout.tsx`
- `src/shell/ui/Transport/Transport.test.tsx`

**Sửa:**
- `src/test/setup.ts` — cài `matchMedia` stub.
- `src/shell/store.ts` — `mobilePane`, `setMobilePane`, `drawerOpen`, `setDrawerOpen`.
- `src/shell/ui/App.tsx` — chọn layout, không còn tự vẽ ba cột.
- `src/shell/ui/App.test.tsx` — thêm nhóm case mobile/tablet.
- `src/shell/ui/Transport/Transport.tsx` — prop `compact`.
- `src/shell/ui/CanvasView/CanvasView.tsx` — `minZoom`, fit lại theo `ResizeObserver` và khi đổi topology.
- `src/brokers/types.ts` — `StatePanel` nhận thêm prop `dense?`.
- `src/brokers/redis/ui/KeyspacePanel.tsx` — dùng `dense`.
- `src/brokers/rabbitmq/ui/InFlightPanel.tsx` — dùng `dense`.
- `src/brokers/redis/ui/NodeConfig.tsx`, `src/brokers/rabbitmq/ui/NodeConfig.tsx` — grid 1 cột ở mobile.
- `src/brokers/rabbitmq/sandbox/ExportDialog.tsx` — modal full màn ở mobile.
- `src/index.css` — `100dvh`, `overscroll-behavior`, utility safe-area.
- `index.html` — `viewport-fit=cover`.
- `README.md` — mục responsive.

---

### Task 1: `matchMedia` cho jsdom + hook `useMediaQuery`

**Files:**
- Create: `src/test/viewport.ts`
- Create: `src/shell/ui/useMediaQuery.ts`
- Modify: `src/test/setup.ts`
- Test: `src/shell/ui/useMediaQuery.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `src/test/viewport.ts`: `installMatchMedia(): void`, `setViewportWidth(width: number): void`, `resetViewport(): void` (đặt về 1280).
  - `src/shell/ui/useMediaQuery.ts`: `MOBILE_QUERY: string`, `TABLET_QUERY: string`, `useMediaQuery(query: string): boolean`, `useIsMobile(): boolean`, `useIsTablet(): boolean`.

- [ ] **Step 1: Viết test thất bại**

`src/shell/ui/useMediaQuery.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetViewport, setViewportWidth } from '../../test/viewport'
import { useIsMobile, useIsTablet, useMediaQuery } from './useMediaQuery'

describe('useMediaQuery', () => {
  beforeEach(() => resetViewport())

  it('đọc đúng giá trị ngay lần render đầu, không nhấp nháy qua một lượt sai', () => {
    setViewportWidth(393)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('cập nhật khi viewport đổi', () => {
    setViewportWidth(1280)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => setViewportWidth(393))
    expect(result.current).toBe(true)
  })

  it('393px và 430px là mobile, 768px là tablet, 1024px là desktop', () => {
    const { result } = renderHook(() => ({ mobile: useIsMobile(), tablet: useIsTablet() }))

    act(() => setViewportWidth(393))
    expect(result.current).toEqual({ mobile: true, tablet: false })

    act(() => setViewportWidth(430))
    expect(result.current).toEqual({ mobile: true, tablet: false })

    act(() => setViewportWidth(768))
    expect(result.current).toEqual({ mobile: false, tablet: true })

    act(() => setViewportWidth(1024))
    expect(result.current).toEqual({ mobile: false, tablet: false })
  })

  it('gỡ listener khi unmount, không rò rỉ qua các test sau', () => {
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 500px)'))
    expect(result.current).toBe(false)
    unmount()
    // Không throw, và listener đã bị gỡ — nếu còn, React sẽ cảnh báo set state
    // trên component đã unmount ở dòng dưới.
    act(() => setViewportWidth(400))
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/useMediaQuery.test.ts`
Expected: FAIL — `Failed to resolve import "../../test/viewport"` và `"./useMediaQuery"`.

- [ ] **Step 3: Viết helper viewport cho test**

`src/test/viewport.ts`:

```ts
// jsdom không có `window.matchMedia`. `useMediaQuery` gọi nó ở mọi lần render, nên
// mọi test mount `App` sẽ throw nếu thiếu. Stub này parse `min-width`/`max-width`
// của query so với một chiều rộng giả đổi được bằng `setViewportWidth`, nên test
// mô phỏng được iPhone mà không cần môi trường trình duyệt thật.
let currentWidth = 1280
const listeners = new Set<() => void>()

/** Chiều rộng mặc định — desktop. Mọi test cũ vì thế không phải sửa một dòng nào. */
const DEFAULT_WIDTH = 1280

function queryMatches(query: string): boolean {
  const min = query.match(/min-width:\s*(\d+)px/)
  const max = query.match(/max-width:\s*(\d+)px/)
  if (min && currentWidth < Number(min[1])) return false
  if (max && currentWidth > Number(max[1])) return false
  return true
}

export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    // Getter, không phải giá trị chốt lúc tạo: `useSyncExternalStore` gọi
    // `matchMedia(query).matches` mỗi lần lấy snapshot, và phải thấy chiều rộng
    // hiện tại chứ không phải chiều rộng lúc object này ra đời.
    get matches() {
      return queryMatches(query)
    },
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: () => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: () => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** Gọi trong `act(...)` — nó bắn listener và làm React render lại. */
export function setViewportWidth(width: number): void {
  currentWidth = width
  for (const listener of listeners) listener()
}

export function resetViewport(): void {
  setViewportWidth(DEFAULT_WIDTH)
}
```

- [ ] **Step 4: Cài stub vào setup file**

Thêm vào cuối `src/test/setup.ts`:

```ts
import { installMatchMedia } from './viewport'

// Cài một lần cho mọi test file. Mặc định 1280px, nên test nào không tự đổi
// viewport vẫn nhận desktop layout y như trước khi có responsive.
installMatchMedia()
```

- [ ] **Step 5: Viết hook**

`src/shell/ui/useMediaQuery.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react'

export const MOBILE_QUERY = '(max-width: 767px)'
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

/**
 * `useSyncExternalStore` chứ không phải `useState` + `useEffect`: cách sau render
 * lượt đầu bằng giá trị mặc định rồi mới sửa trong effect, nên ở mobile màn hình
 * chớp qua desktop layout một frame — và ở test, lượt render đầu trả sai.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  // Snapshot cho server: app này chỉ chạy trong browser, nhưng đối số thứ ba là
  // bắt buộc và trả `false` giữ desktop làm mặc định an toàn nhất.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

export function useIsTablet(): boolean {
  return useMediaQuery(TABLET_QUERY)
}
```

- [ ] **Step 6: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/useMediaQuery.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 7: Chạy toàn bộ suite, xác nhận không hồi quy**

Run: `npm test && npm run typecheck`
Expected: toàn bộ xanh, không test cũ nào đỏ.

- [ ] **Step 8: Commit**

```bash
git add src/test/viewport.ts src/test/setup.ts src/shell/ui/useMediaQuery.ts src/shell/ui/useMediaQuery.test.ts
git commit -m "feat(shell): useMediaQuery hook and jsdom matchMedia stub"
```

---

### Task 2: Trạng thái pane mobile và drawer trong store

**Files:**
- Modify: `src/shell/store.ts`
- Test: `src/shell/store.test.ts` (tạo mới nếu chưa có; nếu đã có thì thêm `describe`)

**Interfaces:**
- Consumes: không có.
- Produces: trên `AppState` — `mobilePane: MobilePane`, `setMobilePane(pane: MobilePane): void`, `drawerOpen: boolean`, `setDrawerOpen(open: boolean): void`; export `type MobilePane = 'lessons' | 'canvas' | 'state'`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/shell/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './store'

describe('mobilePane', () => {
  beforeEach(() => {
    useAppStore.setState({ mobilePane: 'canvas', drawerOpen: false, sandbox: false })
  })

  it('mặc định là canvas — người học mở app là muốn thấy mô phỏng', () => {
    expect(useAppStore.getState().mobilePane).toBe('canvas')
  })

  it('setMobilePane đổi pane', () => {
    useAppStore.getState().setMobilePane('state')
    expect(useAppStore.getState().mobilePane).toBe('state')
  })

  it('chọn lesson đẩy pane về canvas và đóng drawer', () => {
    useAppStore.setState({ mobilePane: 'lessons', drawerOpen: true })
    useAppStore.getState().setLesson('02-direct')
    expect(useAppStore.getState().mobilePane).toBe('canvas')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('mở sandbox cũng đẩy pane về canvas và đóng drawer', () => {
    useAppStore.setState({ mobilePane: 'lessons', drawerOpen: true })
    useAppStore.getState().openSandbox()
    expect(useAppStore.getState().mobilePane).toBe('canvas')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })

  it('đổi broker đóng drawer', () => {
    useAppStore.setState({ drawerOpen: true })
    useAppStore.getState().setBroker('redis')
    expect(useAppStore.getState().drawerOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/store.test.ts -t 'mobilePane'`
Expected: FAIL — `mobilePane` là `undefined`.

- [ ] **Step 3: Thêm state và action vào store**

Trong `src/shell/store.ts`, thêm type và các field vào `AppState`:

```ts
export type MobilePane = 'lessons' | 'canvas' | 'state'
```

```ts
  /** Pane đang hiển thị ở layout mobile. Sống ở store chứ không phải `useState`
   *  trong `App` vì `setLesson`/`openSandbox` phải đẩy nó về `'canvas'` — một
   *  action của store không với tới được state cục bộ của component. */
  mobilePane: MobilePane
  /** Drawer sidebar ở layout tablet. */
  drawerOpen: boolean
  setMobilePane(pane: MobilePane): void
  setDrawerOpen(open: boolean): void
```

Giá trị khởi tạo, ngay dưới `replayToken: 0,`:

```ts
    mobilePane: 'canvas',
    drawerOpen: false,
```

Action, đặt cạnh `selectNode`:

```ts
    setMobilePane(pane) {
      set({ mobilePane: pane })
    },

    setDrawerOpen(open) {
      set({ drawerOpen: open })
    },
```

Thêm `mobilePane: 'canvas', drawerOpen: false` vào object mà `setLesson` và `openSandbox` `set`, và thêm `drawerOpen: false` vào object của `setBroker`. Ví dụ `setLesson`:

```ts
    setLesson(id) {
      set((s) => ({
        lessonId: id,
        sandbox: false,
        playing: false,
        virtualTime: 0,
        selectedNodeId: undefined,
        replayToken: s.replayToken + 1,
        // Vừa chọn bài xong thì thứ người học muốn thấy là mô phỏng, không phải
        // danh sách bài — ở mobile, đứng nguyên tab `lessons` trông như bấm hụt.
        mobilePane: 'canvas',
        drawerOpen: false,
      }))
    },
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/store.test.ts && npx vitest run src/shell/store.importOrder.test.ts`
Expected: PASS cả hai — `store.ts` không thêm import mới nào nên `importOrder` vẫn đúng.

- [ ] **Step 5: Commit**

```bash
git add src/shell/store.ts src/shell/store.test.ts
git commit -m "feat(shell): mobilePane and drawerOpen state in app store"
```

---

### Task 3: `Transport` chế độ compact

**Files:**
- Modify: `src/shell/ui/Transport/Transport.tsx`
- Test: `src/shell/ui/Transport/Transport.test.tsx`

**Interfaces:**
- Consumes: không có.
- Produces: `Transport({ durationMs, onStep, compact }: { durationMs: number; onStep(): void; compact?: boolean })`.

- [ ] **Step 1: Viết test thất bại**

`src/shell/ui/Transport/Transport.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Transport } from './Transport'

describe('Transport', () => {
  it('chế độ thường hiện đủ chữ trên nút', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Chạy lại' })).toHaveTextContent('Chạy lại')
    expect(screen.getByRole('button', { name: 'Bước' })).toHaveTextContent('Bước')
  })

  it('chế độ compact vẫn tìm được nút bằng accessible name dù chữ đã thành icon', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    expect(screen.getByRole('button', { name: 'Chạy lại' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bước' })).toBeInTheDocument()
    expect(screen.getByTestId('play-pause')).toBeInTheDocument()
  })

  it('chế độ compact cho mọi nút tap target tối thiểu 44px', () => {
    render(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11')
    }
  })

  it('slider scrub luôn có mặt ở cả hai chế độ', () => {
    const { rerender } = render(<Transport durationMs={10_000} onStep={vi.fn()} />)
    expect(screen.getByLabelText('scrub')).toBeInTheDocument()
    rerender(<Transport durationMs={10_000} onStep={vi.fn()} compact />)
    expect(screen.getByLabelText('scrub')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/Transport/Transport.test.tsx`
Expected: FAIL — compact chưa tồn tại nên nút không có `min-h-11`, và `getByRole('button', { name: 'Bước' })` ở compact tìm thấy nút có text thay vì aria-label (test vẫn pass ở case đó, nhưng case `min-h-11` đỏ).

- [ ] **Step 3: Thêm prop `compact`**

`src/shell/ui/Transport/Transport.tsx` — thay toàn bộ nội dung component:

```tsx
import { SPEEDS, useAppStore, type Speed } from '../../store'

export function Transport({
  durationMs,
  onStep,
  compact = false,
}: {
  durationMs: number
  onStep(): void
  /** Bật ở mobile: nút thu về icon, tap target nâng lên 44px. Prop chứ không phải
   *  `useIsMobile()` bên trong — giữ component thuần và test được cả hai chế độ
   *  mà không phải giả lập viewport. */
  compact?: boolean
}) {
  const playing = useAppStore((s) => s.playing)
  const speed = useAppStore((s) => s.speed)
  const virtualTime = useAppStore((s) => s.virtualTime)
  const play = useAppStore((s) => s.play)
  const pause = useAppStore((s) => s.pause)
  const seek = useAppStore((s) => s.seek)
  const setSpeed = useAppStore((s) => s.setSpeed)

  const max = durationMs + 5000
  const tap = compact ? 'min-h-11 min-w-11' : ''

  return (
    <div className={`flex items-center px-3 py-2 ${compact ? 'gap-1.5' : 'gap-3'}`} data-testid="transport">
      <button
        onClick={() => seek(0)}
        aria-label="Chạy lại"
        className={`rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 ${tap}`}
      >
        {compact ? '⟲' : 'Chạy lại'}
      </button>
      <button
        onClick={() => (playing ? pause() : play())}
        className={`rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 ${tap}`}
        data-testid="play-pause"
      >
        {playing ? 'Tạm dừng' : 'Chạy'}
      </button>
      <button
        onClick={() => {
          pause()
          onStep()
        }}
        aria-label="Bước"
        className={`rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 ${tap}`}
      >
        {compact ? '⏭' : 'Bước'}
      </button>

      <input
        type="range"
        min={0}
        max={max}
        step={50}
        value={Math.min(virtualTime, max)}
        onChange={(e) => seek(Number(e.target.value))}
        className="min-w-0 flex-1 accent-sky-500"
        aria-label="scrub"
      />
      <span className={`shrink-0 text-right font-mono text-[11px] text-slate-400 ${compact ? 'w-11' : 'w-16'}`}>
        {(virtualTime / 1000).toFixed(1)}s
      </span>

      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className={`shrink-0 rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 ${compact ? 'min-h-11' : ''}`}
        aria-label="speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  )
}
```

Lưu ý: `aria-label` đặt ở cả hai chế độ. Ở chế độ thường, accessible name lấy từ `aria-label` (trùng đúng chữ hiển thị), nên test cũ tìm nút theo text vẫn đúng.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/Transport/Transport.test.tsx && npx vitest run src/shell/ui/App.test.tsx`
Expected: PASS cả hai — `App.test.tsx` dùng `data-testid` nên không bị ảnh hưởng.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/Transport/
git commit -m "feat(shell): compact Transport mode with 44px tap targets"
```

---

### Task 4: `MobileTabBar`

**Files:**
- Create: `src/shell/ui/MobileTabBar/MobileTabBar.tsx`
- Test: `src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` với `mobilePane` / `setMobilePane` (Task 2).
- Produces: `MobileTabBar(): JSX.Element` — không nhận prop, đọc thẳng store.

- [ ] **Step 1: Viết test thất bại**

`src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../../store'
import { MobileTabBar } from './MobileTabBar'

describe('MobileTabBar', () => {
  beforeEach(() => useAppStore.setState({ mobilePane: 'canvas' }))

  it('có ba tab tiếng Việt', () => {
    render(<MobileTabBar />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Bài học', 'Canvas', 'Trạng thái'])
  })

  it('đánh dấu tab đang chọn bằng aria-selected', () => {
    render(<MobileTabBar />)
    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Bài học' })).toHaveAttribute('aria-selected', 'false')
  })

  it('bấm tab đổi mobilePane trong store', async () => {
    render(<MobileTabBar />)
    await userEvent.click(screen.getByRole('tab', { name: 'Trạng thái' }))
    expect(useAppStore.getState().mobilePane).toBe('state')
  })

  it('mỗi tab đạt tap target 44px', () => {
    render(<MobileTabBar />)
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('min-h-11')
    }
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`
Expected: FAIL — `Failed to resolve import "./MobileTabBar"`.

- [ ] **Step 3: Viết component**

`src/shell/ui/MobileTabBar/MobileTabBar.tsx`:

```tsx
import { useAppStore, type MobilePane } from '../../store'

const TABS: { id: MobilePane; label: string }[] = [
  { id: 'lessons', label: 'Bài học' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'state', label: 'Trạng thái' },
]

export function MobileTabBar() {
  const pane = useAppStore((s) => s.mobilePane)
  const setPane = useAppStore((s) => s.setMobilePane)

  return (
    <div
      role="tablist"
      // `pb-safe` là utility tự viết trong `src/index.css`: iPhone có home
      // indicator chiếm ~34px dưới đáy, thiếu padding này thì tab cuối bị nuốt.
      className="flex shrink-0 border-t border-slate-800 pb-safe"
      data-testid="mobile-tabbar"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={pane === tab.id}
          onClick={() => setPane(tab.id)}
          className={`min-h-11 flex-1 text-xs ${
            pane === tab.id ? 'bg-slate-800 text-sky-300' : 'text-slate-400'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/MobileTabBar/MobileTabBar.test.tsx`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/MobileTabBar/
git commit -m "feat(shell): MobileTabBar with three panes"
```

---

### Task 5: `TopBar`

**Files:**
- Create: `src/shell/ui/TopBar/TopBar.tsx`
- Test: `src/shell/ui/TopBar/TopBar.test.tsx`

**Interfaces:**
- Consumes: `BrokerSwitcher` từ `../BrokerSwitcher/BrokerSwitcher`.
- Produces: `TopBar({ title, onOpenDrawer }: { title: string; onOpenDrawer?: () => void })`. Nút hamburger chỉ render khi `onOpenDrawer` được truyền.

- [ ] **Step 1: Viết test thất bại**

`src/shell/ui/TopBar/TopBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('hiện tên bài đang mở', () => {
    render(<TopBar title="Direct exchange" />)
    expect(screen.getByText('Direct exchange')).toBeInTheDocument()
  })

  it('không có nút hamburger khi không truyền onOpenDrawer', () => {
    render(<TopBar title="Direct exchange" />)
    expect(screen.queryByRole('button', { name: 'Mở danh sách bài học' })).toBeNull()
  })

  it('bấm hamburger gọi onOpenDrawer', async () => {
    const onOpenDrawer = vi.fn()
    render(<TopBar title="Direct exchange" onOpenDrawer={onOpenDrawer} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở danh sách bài học' }))
    expect(onOpenDrawer).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/TopBar/TopBar.test.tsx`
Expected: FAIL — `Failed to resolve import "./TopBar"`.

- [ ] **Step 3: Viết component**

`src/shell/ui/TopBar/TopBar.tsx`:

```tsx
import { BrokerSwitcher } from '../BrokerSwitcher/BrokerSwitcher'

export function TopBar({ title, onOpenDrawer }: { title: string; onOpenDrawer?: () => void }) {
  return (
    <header
      // `pt-safe` bù cho Dynamic Island / notch khi trang chạy full-bleed.
      className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-2 pt-safe"
      data-testid="top-bar"
    >
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          aria-label="Mở danh sách bài học"
          className="min-h-11 min-w-11 rounded text-slate-300 hover:bg-slate-800"
        >
          ☰
        </button>
      )}
      <BrokerSwitcher />
      <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{title}</span>
    </header>
  )
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/TopBar/TopBar.test.tsx`
Expected: PASS — 3 test.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/TopBar/
git commit -m "feat(shell): TopBar for mobile and tablet"
```

---

### Task 6: Ba layout + `App` chọn layout

**Files:**
- Create: `src/shell/ui/layouts/types.ts`
- Create: `src/shell/ui/layouts/SidePanel.tsx`
- Create: `src/shell/ui/layouts/DesktopLayout.tsx`
- Create: `src/shell/ui/layouts/TabletLayout.tsx`
- Create: `src/shell/ui/layouts/MobileLayout.tsx`
- Modify: `src/shell/ui/App.tsx`
- Test: `src/shell/ui/App.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile`/`useIsTablet` (Task 1), `mobilePane`/`drawerOpen` (Task 2), `Transport` prop `compact` (Task 3), `MobileTabBar` (Task 4), `TopBar` (Task 5).
- Produces: `LayoutProps` (dưới đây); `DesktopLayout(props: LayoutProps)`, `TabletLayout(props: LayoutProps)`, `MobileLayout(props: LayoutProps)`, `SidePanel(props: Pick<LayoutProps, 'broker' | 'lesson' | 'state' | 'issues' | 'inSandbox'>)`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/shell/ui/App.test.tsx`:

```tsx
import { act } from '@testing-library/react'
import { resetViewport, setViewportWidth } from '../../test/viewport'
import { useAppStore } from '../store'

describe('layout responsive', () => {
  beforeEach(() => {
    resetViewport()
    useAppStore.setState({ mobilePane: 'canvas', drawerOpen: false })
  })

  it('desktop dựng cả sidebar, canvas lẫn inspector cùng lúc', () => {
    setViewportWidth(1280)
    render(<App />)
    expect(screen.getByTestId('lesson-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.getByTestId('inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tabbar')).toBeNull()
    expect(screen.queryByTestId('top-bar')).toBeNull()
  })

  it('mobile chỉ dựng đúng một pane, cộng top bar và tab bar', () => {
    setViewportWidth(393)
    render(<App />)
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-tabbar')).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-sidebar')).toBeNull()
    expect(screen.queryByTestId('inspector')).toBeNull()
  })

  it('mobile đổi tab đổi pane', async () => {
    setViewportWidth(393)
    render(<App />)

    await userEvent.click(screen.getByRole('tab', { name: 'Bài học' }))
    expect(screen.getByTestId('lesson-sidebar')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: 'Trạng thái' }))
    expect(screen.getByTestId('inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-sidebar')).toBeNull()
  })

  it('mobile giữ Transport ở cả ba tab', async () => {
    setViewportWidth(393)
    render(<App />)
    for (const name of ['Bài học', 'Canvas', 'Trạng thái']) {
      await userEvent.click(screen.getByRole('tab', { name }))
      expect(screen.getByTestId('transport')).toBeInTheDocument()
    }
  })

  it('tablet ẩn sidebar sau drawer, mở bằng hamburger', async () => {
    setViewportWidth(820)
    render(<App />)
    expect(screen.queryByTestId('lesson-sidebar')).toBeNull()
    expect(screen.getByTestId('inspector')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Mở danh sách bài học' }))
    expect(screen.getByTestId('lesson-sidebar')).toBeInTheDocument()
  })

  it('đổi viewport lúc đang chạy thì đổi layout, không phải reload', () => {
    setViewportWidth(1280)
    render(<App />)
    expect(screen.queryByTestId('mobile-tabbar')).toBeNull()

    act(() => setViewportWidth(393))
    expect(screen.getByTestId('mobile-tabbar')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/App.test.tsx -t 'layout responsive'`
Expected: FAIL — không tìm thấy `top-bar`/`mobile-tabbar`; `App` vẫn dựng ba cột ở mọi viewport.

- [ ] **Step 3: Viết `LayoutProps` và `SidePanel`**

`src/shell/ui/layouts/types.ts`:

```ts
import type { AnyBrokerModule } from '../../../brokers/types'
import type { KernelState, ValidationIssueBase } from '../../kernel/types'
import type { Lesson } from '../../lesson/types'

/**
 * Mọi thứ ba layout cần, đã được `App` tính sẵn. Cố ý là một object phẳng chứ
 * không phải children: `App` là nơi duy nhất gọi `useSimulation()`, và mỗi layout
 * chỉ được phép vẽ. Một layout tự gọi hook phụ thuộc broker sẽ tái hiện đúng bẫy
 * Rules of Hooks mà `useSimulation.ts` đã ghi chú.
 */
export interface LayoutProps {
  broker: AnyBrokerModule
  /** Vắng mặt chỉ khi đang ở sandbox. */
  lesson?: Lesson<unknown, unknown>
  state: KernelState
  issues: ValidationIssueBase[]
  topology: unknown
  script: unknown[]
  highlight?: string[]
  durationMs: number
  editable: boolean
  inSandbox: boolean
  onStep(): void
}
```

`src/shell/ui/layouts/SidePanel.tsx`:

```tsx
import { Inspector } from '../Inspector/Inspector'
import type { LayoutProps } from './types'

/** Cùng một quyết định "inspector hay sandbox panel" ở cả ba layout — tách ra để
 *  ba nơi không lệch nhau khi một trong ba được sửa. */
export function SidePanel({
  broker,
  lesson,
  state,
  issues,
  inSandbox,
}: Pick<LayoutProps, 'broker' | 'lesson' | 'state' | 'issues' | 'inSandbox'>) {
  const SandboxPanel = broker.sandbox?.Panel
  if (inSandbox && SandboxPanel) return <SandboxPanel state={state} issues={issues} />
  return <Inspector broker={broker} lesson={lesson!} state={state} issues={issues} />
}
```

- [ ] **Step 4: Viết `DesktopLayout`**

`src/shell/ui/layouts/DesktopLayout.tsx` — sao chép nguyên layout ba cột hiện tại, không đổi class nào:

```tsx
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function DesktopLayout(props: LayoutProps) {
  const { broker, topology, state, script, highlight, editable, durationMs, onStep } = props
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-800">
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
        <div className="border-t border-slate-800">
          <StatePanel state={state} />
        </div>
        <div className="border-t border-slate-800">
          <Transport durationMs={durationMs} onStep={onStep} />
        </div>
      </main>
      <aside className="w-80 shrink-0 border-l border-slate-800 p-3">
        <SidePanel {...props} />
      </aside>
    </div>
  )
}
```

- [ ] **Step 5: Viết `TabletLayout`**

`src/shell/ui/layouts/TabletLayout.tsx`:

```tsx
import { useAppStore } from '../../store'
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function TabletLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const drawerOpen = useAppStore((s) => s.drawerOpen)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
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
          <div className="border-t border-slate-800">
            <StatePanel state={state} dense />
          </div>
          <div className="border-t border-slate-800">
            <Transport durationMs={durationMs} onStep={onStep} />
          </div>
        </main>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-slate-800 p-3">
          <SidePanel {...props} />
        </aside>
      </div>

      {drawerOpen && (
        <>
          {/* Backdrop nhận chạm để đóng. `aria-hidden` vì nó không mang nội dung —
              nút đóng thật là hamburger ở TopBar và bản thân việc chọn lesson. */}
          <div
            aria-hidden
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-10 bg-slate-950/70"
          />
          <aside className="fixed inset-y-0 left-0 z-20 w-64 border-r border-slate-800 bg-slate-950">
            <LessonSidebar />
          </aside>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Viết `MobileLayout`**

`src/shell/ui/layouts/MobileLayout.tsx`:

```tsx
import { useAppStore } from '../../store'
import { CanvasView } from '../CanvasView/CanvasView'
import { LessonSidebar } from '../LessonSidebar/LessonSidebar'
import { MobileTabBar } from '../MobileTabBar/MobileTabBar'
import { TopBar } from '../TopBar/TopBar'
import { Transport } from '../Transport/Transport'
import { SidePanel } from './SidePanel'
import type { LayoutProps } from './types'

export function MobileLayout(props: LayoutProps) {
  const { broker, lesson, topology, state, script, highlight, editable, durationMs, onStep, inSandbox } = props
  const pane = useAppStore((s) => s.mobilePane)
  const StatePanel = broker.StatePanel

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <TopBar title={inSandbox ? 'Sandbox' : (lesson?.title ?? '')} />

      <div className="min-h-0 flex-1">
        {pane === 'lessons' && <LessonSidebar />}

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
            <div className="border-t border-slate-800">
              <StatePanel state={state} dense />
            </div>
          </div>
        )}

        {pane === 'state' && (
          <div className="flex h-full flex-col overflow-y-auto">
            <div className="border-b border-slate-800">
              <StatePanel state={state} />
            </div>
            <div className="min-h-0 flex-1 p-3">
              <SidePanel {...props} />
            </div>
          </div>
        )}
      </div>

      {/* Transport nằm ngoài khối pane: tua thời gian ảo là hành động xuyên suốt,
          ẩn nó ở tab `lessons`/`state` là lấy mất khả năng điều khiển mô phỏng
          đang xem. */}
      <div className="shrink-0 border-t border-slate-800">
        <Transport durationMs={durationMs} onStep={onStep} compact />
      </div>
      <MobileTabBar />
    </div>
  )
}
```

- [ ] **Step 7: Viết lại `App` chỉ còn chọn layout**

`src/shell/ui/App.tsx` — thay toàn bộ:

```tsx
import { getBroker } from '../../brokers/registry'
import { useAppStore } from '../store'
import { useSimulation } from '../useSimulation'
import { activeStepIndex } from '../lesson/activeStep'
import { DesktopLayout } from './layouts/DesktopLayout'
import { MobileLayout } from './layouts/MobileLayout'
import { TabletLayout } from './layouts/TabletLayout'
import type { LayoutProps } from './layouts/types'
import { useIsMobile, useIsTablet } from './useMediaQuery'

export default function App() {
  const brokerId = useAppStore((s) => s.brokerId)
  const broker = getBroker(brokerId)
  const sandbox = useAppStore((s) => s.sandbox)
  const lessonId = useAppStore((s) => s.lessonId)
  const lesson = broker.lessons.find((l) => l.id === lessonId)
  const { state, issues, stepOnce, topology: simTopology, script: simScript } = useSimulation()
  // Hai hook media query gọi vô điều kiện, trước mọi nhánh return: số hook tại
  // call site này không được đổi theo broker hay theo viewport.
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  const inSandbox = sandbox && Boolean(broker.sandbox)

  if (!inSandbox && !lesson) return <div className="p-4 text-slate-200">Không tìm thấy bài học.</div>

  const topology = inSandbox ? simTopology : lesson!.topology
  const script = inSandbox ? simScript : lesson!.script
  const durationMs = inSandbox ? broker.sandbox!.transportDurationMs : lesson!.durationMs
  // The canvas emphasises whatever the narrative step currently on screen names. Resolved
  // here for the same reason `topology`/`script` are: this is the one place that knows
  // whether a lesson or the sandbox is driving, and the sandbox has no narrative at all.
  const highlight = inSandbox
    ? undefined
    : lesson!.narrative[activeStepIndex(lesson!.narrative, state.now)]?.highlight

  const props: LayoutProps = {
    broker,
    lesson,
    state,
    issues,
    topology,
    script,
    highlight,
    durationMs,
    editable: inSandbox,
    inSandbox,
    onStep: stepOnce,
  }

  if (isMobile) return <MobileLayout {...props} />
  if (isTablet) return <TabletLayout {...props} />
  return <DesktopLayout {...props} />
}
```

- [ ] **Step 8: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/App.test.tsx`
Expected: PASS — mọi test cũ (chạy ở 1280px mặc định) cộng 6 test responsive mới.

- [ ] **Step 9: Chạy toàn bộ suite và typecheck**

Run: `npm test && npm run typecheck && npm run lint`
Expected: toàn bộ xanh. `StatePanel state={state} dense` sẽ đỏ typecheck cho tới Task 8 — nếu đỏ, tạm bỏ `dense` khỏi hai layout, làm Task 8 rồi thêm lại; ghi chú đó vào commit message.

- [ ] **Step 10: Commit**

```bash
git add src/shell/ui/layouts/ src/shell/ui/App.tsx src/shell/ui/App.test.tsx
git commit -m "feat(shell): split App into desktop, tablet and mobile layouts"
```

---

### Task 7: `CanvasView` fit lại theo kích thước container

**Files:**
- Modify: `src/shell/ui/CanvasView/CanvasView.tsx`
- Test: `src/shell/ui/CanvasView/CanvasView.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: không có.
- Produces: export `MIN_ZOOM = 0.25` và `FIT_VIEW_OPTIONS = { padding: 0.15 }` từ `CanvasView.tsx` để test khẳng định được giá trị.

- [ ] **Step 1: Viết test thất bại**

`src/shell/ui/CanvasView/CanvasView.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rabbitmq } from '../../../brokers/rabbitmq'
import { CanvasView, FIT_VIEW_OPTIONS, MIN_ZOOM } from './CanvasView'

const lesson = rabbitmq.lessons[0]!
const state = rabbitmq.createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed }).snapshot()

describe('CanvasView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('zoom tối thiểu đủ nhỏ để topology lọt vào bề ngang 393px', () => {
    // React Flow mặc định `minZoom` 0.5, không đủ nhỏ cho một cluster nhiều node
    // trên iPhone. Giá trị này là hợp đồng, nên nó được khẳng định tường minh.
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.25)
    expect(FIT_VIEW_OPTIONS.padding).toBeGreaterThan(0)
  })

  it('theo dõi kích thước container để fit lại khi xoay máy hoặc đổi tab', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        unobserve = vi.fn()
        disconnect = disconnect
      },
    )

    const { unmount } = render(
      <CanvasView broker={rabbitmq} topology={lesson.topology} state={state} script={lesson.script} />,
    )
    expect(observe).toHaveBeenCalled()

    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/shell/ui/CanvasView/CanvasView.test.tsx`
Expected: FAIL — `MIN_ZOOM`/`FIT_VIEW_OPTIONS` chưa được export, và `observe` không được gọi.

- [ ] **Step 3: Sửa `CanvasView`**

Trong `src/shell/ui/CanvasView/CanvasView.tsx`:

Thêm import:

```tsx
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
```

Thêm hằng số, ngay dưới `EMPTY_SCRIPT`:

```tsx
/**
 * React Flow mặc định `minZoom` là 0.5. Một cluster ba broker sáu partition không
 * lọt vào bề ngang 393px ở mức đó, nên người dùng iPhone chỉ thấy một góc canvas
 * và không zoom ra xa hơn được.
 */
export const MIN_ZOOM = 0.25
/** Chừa mép để node ngoài cùng không dính sát viền — hằng số vì cả `fitView` lúc
 *  mount lẫn hai effect fit lại bên dưới đều phải dùng đúng một giá trị. */
export const FIT_VIEW_OPTIONS = { padding: 0.15 }
```

Bên trong component, sau các `useCallback` hiện có:

```tsx
  const containerRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance | null>(null)

  // Xoay máy, đổi tab ở mobile, hay bàn phím ảo hiện lên đều đổi kích thước
  // container mà không đổi prop nào — không có `ResizeObserver` thì viewport giữ
  // nguyên transform cũ và topology nằm lệch ngoài khung.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      // Gộp nhiều lần báo kích thước trong cùng một frame. `requestAnimationFrame`
      // chứ không phải `setTimeout` — file này ở `src/shell/ui/`, ngoài vùng
      // `purity.test.ts` soi, nhưng không tạo tiền lệ dùng timer trong repo.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => flowRef.current?.fitView(FIT_VIEW_OPTIONS))
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // Đổi lesson hay đổi broker là đổi hẳn bộ node; viewport cũ gần như chắc chắn
  // sai khung.
  useEffect(() => {
    flowRef.current?.fitView(FIT_VIEW_OPTIONS)
  }, [broker, topology])
```

Sửa phần JSX:

```tsx
    <div ref={containerRef} className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={broker.nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        onInit={(instance) => {
          flowRef.current = instance
        }}
        proOptions={{ hideAttribution: true }}
```

Phần còn lại giữ nguyên.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run src/shell/ui/CanvasView/CanvasView.test.tsx && npx vitest run src/shell/ui/App.test.tsx`
Expected: PASS cả hai.

- [ ] **Step 5: Commit**

```bash
git add src/shell/ui/CanvasView/
git commit -m "feat(shell): refit canvas on container resize and lower minZoom"
```

---

### Task 8: Prop `dense` cho `StatePanel` ở cả hai broker

**Files:**
- Modify: `src/brokers/types.ts`
- Modify: `src/brokers/redis/ui/KeyspacePanel.tsx:53`
- Modify: `src/brokers/rabbitmq/ui/InFlightPanel.tsx:17`
- Test: `src/brokers/redis/ui/KeyspacePanel.test.tsx`, `src/brokers/rabbitmq/ui/InFlightPanel.test.tsx`

**Interfaces:**
- Consumes: `LayoutProps` truyền `dense` (Task 6).
- Produces: `BrokerModule.StatePanel: ComponentType<{ state: S; dense?: boolean }>`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/brokers/redis/ui/KeyspacePanel.test.tsx`:

```tsx
it('dense siết chiều cao lại cho màn hình nhỏ', () => {
  const { rerender } = render(<KeyspacePanel state={state} />)
  expect(screen.getByTestId('keyspace-panel').className).toContain('max-h-32')

  rerender(<KeyspacePanel state={state} dense />)
  expect(screen.getByTestId('keyspace-panel').className).toContain('max-h-24')
  expect(screen.getByTestId('keyspace-panel').className).not.toContain('max-h-32')
})
```

Thêm case tương đương vào `src/brokers/rabbitmq/ui/InFlightPanel.test.tsx`, đổi `keyspace-panel` thành `inflight-panel` và `KeyspacePanel` thành `InFlightPanel`.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/redis/ui/KeyspacePanel.test.tsx src/brokers/rabbitmq/ui/InFlightPanel.test.tsx`
Expected: FAIL — `dense` không phải prop hợp lệ; class vẫn là `max-h-32`.

- [ ] **Step 3: Mở rộng hợp đồng `BrokerModule`**

Trong `src/brokers/types.ts`, thay dòng `StatePanel`:

```ts
  /** `dense` bật ở layout mobile/tablet, nơi panel này chia chiều cao với canvas.
   *  Optional nên broker chưa dùng tới vẫn compile — shell luôn truyền, broker tự
   *  quyết định có nghe hay không. */
  StatePanel: ComponentType<{ state: S; dense?: boolean }>
```

- [ ] **Step 4: Sửa hai panel**

`src/brokers/redis/ui/KeyspacePanel.tsx` — đổi chữ ký và class ngoài cùng:

```tsx
export function KeyspacePanel({ state, dense = false }: { state: RedisState; dense?: boolean }) {
```

```tsx
    <div className={`overflow-y-auto px-3 py-2 ${dense ? 'max-h-24' : 'max-h-32'}`} data-testid="keyspace-panel">
```

`src/brokers/rabbitmq/ui/InFlightPanel.tsx` — cùng cách, `data-testid="inflight-panel"` giữ nguyên.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run src/brokers/redis/ui/KeyspacePanel.test.tsx src/brokers/rabbitmq/ui/InFlightPanel.test.tsx && npm run typecheck`
Expected: PASS, và typecheck xanh — bao gồm cả `StatePanel state={state} dense` trong hai layout ở Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/types.ts src/brokers/redis/ui/KeyspacePanel.tsx src/brokers/redis/ui/KeyspacePanel.test.tsx src/brokers/rabbitmq/ui/InFlightPanel.tsx src/brokers/rabbitmq/ui/InFlightPanel.test.tsx
git commit -m "feat(brokers): dense prop on StatePanel for small screens"
```

---

### Task 9: CSS nền tảng — `100dvh`, safe area, viewport meta

**Files:**
- Modify: `src/index.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: không có.
- Produces: utility class `pt-safe`, `pb-safe` dùng bởi `TopBar` (Task 5) và `MobileTabBar` (Task 4).

- [ ] **Step 1: Sửa `index.html`**

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

`viewport-fit=cover` là điều kiện bắt buộc để `env(safe-area-inset-*)` trả về khác 0 trên iOS. Thiếu nó thì `pt-safe`/`pb-safe` luôn bằng 0 và tab bar nằm dưới home indicator.

- [ ] **Step 2: Sửa `src/index.css`**

Thay khối `html, body, #root { height: 100%; }` bằng:

```css
html, body, #root {
  height: 100vh;   /* fallback cho browser chưa có dvh */
  height: 100dvh;  /* Safari iOS co giãn thanh địa chỉ; 100% ở đó nhảy khi cuộn */
}

body {
  /* Chặn bounce và pull-to-refresh của Safari iOS: canvas được pan bằng một
     ngón, và không có dòng này thì mỗi cú pan dọc lại kéo cả trang. */
  overscroll-behavior: none;
}

/* Tailwind không có utility cho safe area, và thêm hẳn một plugin chỉ vì hai
   class là thừa. iPhone 15 có Dynamic Island trên đỉnh và home indicator ~34px
   dưới đáy; thiếu hai class này thì TopBar bị che và tab cuối bị nuốt. */
@layer utilities {
  .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
  .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0px); }
}
```

- [ ] **Step 3: Chạy suite và build, xác nhận không hỏng**

Run: `npm test && npm run build`
Expected: cả hai xanh. `@layer utilities` được Tailwind xử lý lúc build; build đỏ nghĩa là cú pháp sai.

- [ ] **Step 4: Kiểm thủ công trên DevTools**

Run: `npm run dev`
Mở DevTools, bật device toolbar, kiểm lần lượt ở **393×852** (iPhone 15 / 15 Pro), **430×932** (15 Pro Max), **375×667** (SE), **820×1180** (iPad ngang tablet), **1280×800** (desktop):

- Không có thanh cuộn ngang ở bất kỳ kích thước nào.
- Ở 393px: top bar + pane + transport + tab bar vừa đúng một màn, không pane nào bị cắt.
- Đổi cả ba tab, canvas fit lại đúng khung mỗi lần quay lại tab Canvas.
- Xoay ngang (852×393): canvas fit lại, tab bar vẫn ở đáy.
- Ở 1280px: layout giống hệt trước khi làm plan này.

- [ ] **Step 5: Commit**

```bash
git add src/index.css index.html
git commit -m "feat(shell): dvh height, safe-area utilities and viewport-fit=cover"
```

---

### Task 10: Panel và dialog của broker vừa màn nhỏ

**Files:**
- Modify: `src/brokers/redis/ui/NodeConfig.tsx`
- Modify: `src/brokers/rabbitmq/ui/NodeConfig.tsx`
- Modify: `src/brokers/rabbitmq/sandbox/ExportDialog.tsx`
- Modify: `src/brokers/rabbitmq/sandbox/SandboxPanel.tsx`
- Modify: `src/brokers/redis/ui/nodes.tsx`, `src/brokers/rabbitmq/ui/nodes.tsx`
- Test: `src/brokers/redis/ui/NodeConfig.test.tsx`, `src/brokers/rabbitmq/sandbox/SandboxPanel.test.tsx`

**Interfaces:**
- Consumes: không có.
- Produces: không có API mới — chỉ thay class.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/brokers/redis/ui/NodeConfig.test.tsx`:

```tsx
it('lưới thuộc tính xuống một cột ở màn hẹp', () => {
  const { container } = render(<NodeConfig lesson={lesson} state={state} nodeId="redis" />)
  const grid = container.querySelector('[class*="grid-cols"]')
  expect(grid?.className).toContain('grid-cols-1')
  expect(grid?.className).toContain('sm:grid-cols-2')
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run src/brokers/redis/ui/NodeConfig.test.tsx`
Expected: FAIL — class hiện là `grid-cols-2`, không có `grid-cols-1`.

- [ ] **Step 3: Sửa class**

Trong cả `src/brokers/redis/ui/NodeConfig.tsx` và `src/brokers/rabbitmq/ui/NodeConfig.tsx`, mọi chỗ `grid-cols-2` đổi thành `grid-cols-1 sm:grid-cols-2`.

Trong `src/brokers/rabbitmq/sandbox/ExportDialog.tsx`, đổi khung modal thành:

```tsx
      className="fixed inset-0 z-30 flex flex-col bg-slate-900 md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-[42rem] md:max-w-[90vw] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded md:border md:border-slate-700"
```

Full màn ở mobile (code export dài, cần hết chiều ngang), giữ modal giữa màn từ `md` trở lên. Vùng code bên trong thêm `overflow-auto` và `min-h-0` để cuộn được thay vì tràn.

Trong `src/brokers/rabbitmq/sandbox/SandboxPanel.tsx`, khung ngoài cùng thêm `h-full overflow-y-auto`, và mọi `<button>` thêm `min-h-11 md:min-h-0`.

Trong `src/brokers/redis/ui/nodes.tsx` và `src/brokers/rabbitmq/ui/nodes.tsx`, mọi node có nhãn tự do (tên queue, tên key) thêm `max-w-[200px] truncate` cho phần tử chứa nhãn, để một tên dài không kéo node rộng ra ngoài khung fit.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npm test`
Expected: toàn bộ xanh, gồm cả snapshot của lesson RabbitMQ (thay class không đụng tới journal, nên `__snapshots__/lessons.test.ts.snap` không đổi — nếu snapshot đỏ thì có gì đó đã sửa nhầm vào engine, dừng lại và xem lại diff).

- [ ] **Step 5: Kiểm thủ công sandbox trên mobile**

Run: `npm run dev`, ở 393px, chọn RabbitMQ → tab `Bài học` → nút `Sandbox`:
- `SandboxPanel` cuộn được, không nút nào bị cắt.
- Mở `Xuất code`: dialog chiếm full màn, code cuộn ngang được bên trong khối của nó, nút đóng chạm được.

- [ ] **Step 6: Commit**

```bash
git add src/brokers/redis/ui/ src/brokers/rabbitmq/ui/ src/brokers/rabbitmq/sandbox/
git commit -m "fix(brokers): fit node config, sandbox panel and export dialog to small screens"
```

---

### Task 11: Tài liệu và chốt phase

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: không có.
- Produces: không có.

- [ ] **Step 1: Thêm mục responsive vào `README.md`**

Chèn sau mục "Bắt đầu":

```markdown
## Màn hình nhỏ

Shell chạy được từ 375px trở lên. Ba layout, chọn bằng `useMediaQuery`
(`src/shell/ui/useMediaQuery.ts`) và render bởi `src/shell/ui/layouts/`:

- **mobile** (`< 768px`) — một pane tại một thời điểm, chọn bằng tab bar dưới đáy
  (`Bài học` / `Canvas` / `Trạng thái`). Transport hiện ở cả ba tab.
- **tablet** (`768–1023px`) — canvas và inspector cạnh nhau, sidebar nằm sau drawer
  mở bằng nút hamburger.
- **desktop** (`≥ 1024px`) — ba cột như cũ.

Pane đang chọn sống ở `mobilePane` trong `src/shell/store.ts`, không phải state cục
bộ của component: `setLesson`/`openSandbox` phải đẩy nó về `canvas`.

Test chạy trong jsdom, không có layout thật, nên chúng khẳng định **cấu trúc** (pane
nào render, class nào có mặt). Phần "trông có đúng không" kiểm thủ công bằng DevTools
ở 393×852, 430×932 và 375×667. Sandbox kéo-thả trên điện thoại vẫn là trải nghiệm
kém — mục tiêu của mobile là xem lesson, không phải xây topology.
```

- [ ] **Step 2: Chạy full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: bốn lệnh xanh.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the responsive shell layouts"
```

---

## Self-Review

**Spec coverage (Phần A):**

| Mục spec | Task |
| --- | --- |
| §A2 breakpoint | Task 1 (`MOBILE_QUERY`/`TABLET_QUERY`) |
| §A3 layout mobile, tab bar, tab mặc định `canvas` | Task 2, 4, 6 |
| §A4 layout tablet, drawer | Task 2, 6 |
| §A5 `useMediaQuery` | Task 1 |
| §A5 `TopBar` | Task 5 |
| §A5 `MobileTabBar` | Task 4 |
| §A5 ba layout, `App` không gọi hook theo nhánh | Task 6 |
| §A5 `store.ts` | Task 2 |
| §A5 `Transport` compact | Task 3 |
| §A5 `CanvasView` minZoom / fitView / ResizeObserver | Task 7 |
| §A5 `index.css` dvh, overscroll, safe area | Task 9 |
| §A5 `index.html` viewport-fit | Task 9 |
| §A5 `StatePanel` prop `dense` | Task 8 |
| §A5 `NodeConfig`, `nodes.tsx`, `ExportDialog`, `SandboxPanel` | Task 10 |
| §A6 test | Task 1, 3, 4, 5, 6, 7, 8, 10 + kiểm thủ công Task 9, 10 |

Không mục nào của Phần A thiếu task.

**Type consistency:** `MobilePane` định nghĩa ở Task 2, dùng ở Task 4 và Task 6. `LayoutProps` định nghĩa ở Task 6 Step 3, dùng ở Step 4–7. `MIN_ZOOM`/`FIT_VIEW_OPTIONS` export ở Task 7, chỉ dùng trong chính file đó và test của nó. `dense` khai báo ở Task 8 nhưng dùng ở Task 6 — Task 6 Step 9 ghi rõ thứ tự và cách xử lý nếu typecheck đỏ giữa chừng.

**Phụ thuộc giữa task:** 1 → 2 → (3, 4, 5 song song được) → 6 → 7 → 8 → 9 → 10 → 11. Task 8 phải xong trước khi `npm run typecheck` xanh trọn vẹn.
