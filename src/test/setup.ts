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
