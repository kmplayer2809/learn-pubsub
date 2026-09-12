import { act, render } from '@testing-library/react'
import type { ReactFlowInstance } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rabbitmq } from '../../../brokers/rabbitmq'
import { useAppStore } from '../../store'
import { CanvasView, FIT_VIEW_OPTIONS, MIN_ZOOM, READABLE_ZOOM } from './CanvasView'

const lesson = rabbitmq.lessons[0]!
const otherLesson = rabbitmq.lessons[1]!
const state = rabbitmq.createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed }).snapshot()

// Bọc `ReactFlow` thật để lấy được `ReactFlowInstance` thật ra ngoài test — CanvasView
// chỉ giữ nó trong một ref nội bộ (`flowRef`), không có cách nào khác truy cập từ ngoài.
// `onInit` của React Flow chỉ chạy một lần lúc mount, nên `instanceHolder.current` luôn
// trỏ đúng instance mà `flowRef.current` bên trong CanvasView đang giữ — spy lên
// `instance.fitView` sau đó bắt được đúng mọi lần CanvasView tự gọi lại `fitView()`.
const instanceHolder: { current: ReactFlowInstance | null } = { current: null }

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const RealReactFlow = actual.ReactFlow
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      const onInit = props.onInit as ((instance: ReactFlowInstance) => void) | undefined
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <RealReactFlow
          {...(props as any)}
          onInit={(instance: ReactFlowInstance) => {
            instanceHolder.current = instance
            onInit?.(instance)
          }}
        />
      )
    },
  }
})

describe('CanvasView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    instanceHolder.current = null
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('zoom tối thiểu đủ nhỏ để topology lọt vào bề ngang 393px', () => {
    // React Flow mặc định `minZoom` 0.5, không đủ nhỏ cho một cluster nhiều node
    // trên iPhone. Giá trị này là hợp đồng, nên nó được khẳng định tường minh.
    expect(MIN_ZOOM).toBeLessThanOrEqual(0.25)
    expect(FIT_VIEW_OPTIONS.padding).toBeGreaterThan(0)
  })

  it('fitView không co xuống dưới ngưỡng đọc được', () => {
    // jsdom không có layout thật nên không kiểm được zoom thực tế; khẳng định cấu hình
    // là thứ duy nhất kiểm được ở đây, và nó chính là thứ hay bị sửa nhầm.
    expect(FIT_VIEW_OPTIONS.minZoom).toBe(READABLE_ZOOM)
    expect(READABLE_ZOOM).toBeGreaterThan(MIN_ZOOM)
  })

  it('người dùng vẫn tự zoom xa hơn ngưỡng fitView được', () => {
    expect(MIN_ZOOM).toBe(0.25)
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

  it('fit lại theo brokerId/lessonId — KHÔNG theo mỗi lần topology đổi reference', async () => {
    // Đây chính là bug đã sửa: Sandbox tạo một object `topology` mới trên mỗi lần kéo
    // node (`useSandboxStore.updateNode`), nên nếu effect fit-lại khoá theo `topology`
    // thay vì `brokerId`/`lessonId`, nó sẽ gọi lại `fitView()` mỗi frame kéo — recenter
    // viewport ngay giữa lúc React Flow đang theo dõi thao tác kéo. Test này phải fail
    // với dependency array cũ `[broker, topology]` và pass với `[brokerId, lessonId]`.
    useAppStore.setState({ brokerId: 'rabbitmq', lessonId: lesson.id })

    const { rerender } = render(
      <CanvasView broker={rabbitmq} topology={lesson.topology} state={state} script={lesson.script} />,
    )
    // React Flow tự gọi `onInit` qua `setTimeout(..., 1)` (xem
    // `useOnInitHandler` trong @xyflow/react) — không đồng bộ ngay trong
    // `render()` như effect thường. Chờ theo từng nhịp nhỏ, bọc trong `act()`,
    // dừng ngay khi instance xuất hiện — vừa chịu được dao động lịch trình
    // thật của `setTimeout` trong CI, vừa không chờ lâu hơn cần thiết.
    for (let i = 0; i < 20 && instanceHolder.current === null; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
    const instance = instanceHolder.current
    expect(instance).not.toBeNull()
    const fitView = vi.spyOn(instance!, 'fitView')

    // Object `topology` mới, nội dung giống hệt — đúng thứ `updateNode` trả về mỗi
    // lần kéo một node trong Sandbox. brokerId/lessonId không đổi.
    const clonedTopology = structuredClone(lesson.topology)
    rerender(
      <CanvasView broker={rabbitmq} topology={clonedTopology} state={state} script={lesson.script} />,
    )
    expect(fitView).not.toHaveBeenCalled()

    // Đổi lessonId thật sự qua store — đây mới là lúc phải fit lại.
    useAppStore.setState({ lessonId: otherLesson.id })
    rerender(
      <CanvasView broker={rabbitmq} topology={clonedTopology} state={state} script={lesson.script} />,
    )
    expect(fitView).toHaveBeenCalledTimes(1)
  })
})
