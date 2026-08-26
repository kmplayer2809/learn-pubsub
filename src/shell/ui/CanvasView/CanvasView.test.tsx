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
