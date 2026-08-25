// This jsdom version provides neither ResizeObserver nor DOMMatrixReadOnly,
// both of which @xyflow/react touches at mount (ResizeObserver to watch pane
// and node dimensions, DOMMatrixReadOnly to read the current zoom out of the
// viewport's CSS transform). Any test that renders CanvasView/App needs both
// stubbed, so they live here once instead of duplicated per test file.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Real DOMMatrixReadOnly fully parses CSS transform strings. @xyflow/system
// only reads `m22` (the y-scale, i.e. zoom) off it, so this stub only needs
// to recover that one component from a "translate(x, y) scale(z)" string.
class DOMMatrixReadOnlyStub {
  m22 = 1

  constructor(transform?: string) {
    const match = transform?.match(/scale\(([^,)]+)/)
    if (match) {
      const value = Number.parseFloat(match[1] ?? '')
      if (!Number.isNaN(value)) this.m22 = value
    }
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly
}

// jest-dom's matchers (toBeInTheDocument, toHaveTextContent, …) aren't wired
// into vitest's `expect` by default — this registers them once for every
// test file instead of each one importing '@testing-library/jest-dom/vitest'
// itself.
import '@testing-library/jest-dom/vitest'

import { installMatchMedia } from './viewport'

// Cài một lần cho mọi test file. Mặc định 1280px, nên test nào không tự đổi
// viewport vẫn nhận desktop layout y như trước khi có responsive.
installMatchMedia()
