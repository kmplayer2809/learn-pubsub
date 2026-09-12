import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BROKER_CATALOG } from '../../brokers/catalog'
import { BROKERS, getBroker } from '../../brokers/registry'
import type { AnyBrokerModule } from '../../brokers/types'
import { useSandboxStore } from '../../brokers/rabbitmq/sandbox/sandboxStore'
import { resetViewport, setViewportWidth } from '../../test/viewport'
import { useAppStore } from '../store'
import App from './App'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSandboxStore.getState().reset()
})

/** Ids of the canvas nodes currently wearing the narrative-highlight outline. */
function highlightedNodeIds(): string[] {
  return [...document.querySelectorAll('.outline-highlight')]
    .map((el) => el.closest('.react-flow__node')?.getAttribute('data-id') ?? '')
    .sort()
}

describe('App', () => {
  it('renders all three columns with the first lesson selected', () => {
    render(<App />)
    expect(screen.getByTestId('lesson-sidebar')).toBeTruthy()
    expect(screen.getByTestId('canvas')).toBeTruthy()
    expect(screen.getByTestId('inspector')).toBeTruthy()
    // Desktop's TopBar now also shows the lesson title, alongside the sidebar row —
    // "Hello world" legitimately appears twice.
    expect(screen.getAllByText('Hello world').length).toBeGreaterThan(0)
  })

  it('shows a play button in the transport bar', () => {
    render(<App />)
    expect(screen.getByTestId('play-pause').textContent).toBe('Chạy')
  })

  it('emphasises the nodes the active narrative step names', () => {
    // 01-hello-world's first step (at 0) highlights the publisher and the default
    // exchange; nothing else on the canvas may pick the emphasis up.
    render(<App />)
    expect(highlightedNodeIds()).toEqual(['default', 'p1'])
  })

  it('moves the emphasis when the run advances into the next narrative step', () => {
    // Step 2 (at 2400) is about the queue buffering, and highlights `hello` alone.
    render(<App />)
    act(() => useAppStore.getState().seek(2500))
    expect(highlightedNodeIds()).toEqual(['hello'])
  })

  it('emphasises nothing in the sandbox, which has no narrative', () => {
    // Deliberately reusing the ids 01-hello-world's first step highlights. `lessonId`
    // still points at that lesson while the sandbox is open, so an App that forgot to
    // gate the highlight on `sandbox` would light these two up.
    useSandboxStore.setState(
      {
        topology: {
          publishers: [{ id: 'p1', label: 'p1', position: { x: 0, y: 0 } }],
          exchanges: [{ id: 'default', label: 'default', type: 'direct', position: { x: 120, y: 0 } }],
          queues: [],
          consumers: [],
          bindings: [],
        },
        script: [],
      },
      false,
    )
    act(() => useAppStore.getState().openSandbox())
    render(<App />)

    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(2)
    expect(highlightedNodeIds()).toEqual([])
  })

  it('reveals the lesson checkpoint only once the run reaches it', () => {
    // 01-hello-world's single checkpoint sits at 6000ms.
    render(<App />)
    expect(screen.queryByTestId('checkpoints')).toBeNull()

    act(() => useAppStore.getState().seek(6500))
    expect(screen.getByTestId('checkpoints')).toBeTruthy()
    expect(screen.getByText(/Nếu consumer ngừng ack/)).toBeTruthy()
  })

  it('never shows a checkpoint in the sandbox', () => {
    act(() => useAppStore.getState().openSandbox())
    render(<App />)
    act(() => useAppStore.getState().seek(30_000))
    expect(screen.queryByTestId('checkpoints')).toBeNull()
  })

  it('renders the active broker state panel, not a hard-coded one', () => {
    // Asserting only `inflight-panel` exists would pass just as well against a hard-coded
    // `<InFlightPanel />` — proving nothing about routing. Swapping the module's own
    // `StatePanel` for a marker component and asserting the marker (not InFlightPanel)
    // renders is the only way to actually prove App renders `broker.StatePanel`.
    const broker = getBroker('rabbitmq')
    const original = broker.StatePanel
    const Marker = () => <div data-testid="marker-state-panel" />
    try {
      ;(broker as { StatePanel: unknown }).StatePanel = Marker
      render(<App />)
      expect(screen.getByTestId('marker-state-panel')).toBeTruthy()
      expect(screen.queryByTestId('inflight-panel')).toBeNull()
    } finally {
      ;(broker as { StatePanel: unknown }).StatePanel = original
    }
  })

  it('hides the Sandbox button for a broker that ships without one', () => {
    const broker = getBroker('rabbitmq')
    const original = broker.sandbox
    try {
      // A Redis-shaped module may legitimately have no sandbox; the shell must not
      // render a button that leads nowhere.
      ;(broker as { sandbox?: unknown }).sandbox = undefined
      render(<App />)
      expect(screen.queryByTestId('open-sandbox')).toBeNull()
    } finally {
      ;(broker as { sandbox?: unknown }).sandbox = original
    }
  })

  it('hides the export button for a broker that ships without an ExportDialog', () => {
    const broker = getBroker('rabbitmq')
    const original = broker.ExportDialog
    try {
      // Redis lessons will land before Redis code export does; the shell must not
      // offer a button that opens nothing.
      ;(broker as { ExportDialog?: unknown }).ExportDialog = undefined
      render(<App />)
      expect(screen.queryByTestId('export-button')).toBeNull()
    } finally {
      ;(broker as { ExportDialog?: unknown }).ExportDialog = original
    }
  })

  it('shows the export button for a broker that ships an ExportDialog', () => {
    // The negative case above only proves the button disappears when the slot is empty.
    // `ExportDialog` is optional in the contract (the typechecker can't catch its
    // absence), so the positive case has to be asserted too — otherwise deleting the
    // slot from the RabbitMQ module entirely would silently remove "Xuất code" from
    // every lesson with every other test, typecheck, and lint still green.
    render(<App />)
    expect(screen.getByTestId('export-button')).toBeTruthy()
  })

  it('Inspector export button meets the 44px mobile tap target and shrinks back down from md', () => {
    render(<App />)
    const exportButton = screen.getByTestId('export-button')
    expect(exportButton.className).toContain('min-h-11')
    expect(exportButton.className).toContain('md:min-h-0')
  })

  it('shows the Sandbox button for Kafka, which now ships one', () => {
    // Trước Task 12, chỉ RabbitMQ có `sandbox` — Kafka thì không, nên nút Sandbox từng
    // ẩn khi chuyển sang Kafka. Giờ Kafka đã có `sandbox` (`src/brokers/kafka/index.ts`),
    // nút này phải hiện lại đúng như RabbitMQ.
    render(<App />)
    act(() => useAppStore.getState().setBroker('kafka'))
    expect(screen.getByTestId('open-sandbox')).toBeTruthy()
  })

  it('renders the Redis keyspace panel, with no inflight panel or sandbox button', () => {
    // Redis ships neither `sandbox` nor `ExportDialog` (both optional slots); this is
    // the proof the shell reads that as genuinely optional rather than crashing or
    // falling back to RabbitMQ's own panel and buttons.
    render(<App />)
    act(() => useAppStore.getState().setBroker('redis'))
    expect(screen.getByTestId('keyspace-panel')).toBeTruthy()
    expect(screen.queryByTestId('inflight-panel')).toBeNull()
    expect(screen.queryByTestId('open-sandbox')).toBeNull()
  })

  it('renders the new broker with its own state, not the previous broker stale snapshot', () => {
    // Reproduces the exact hazard: `useSimulation` recomputes its `input` during render
    // but only rebuilds the simulation in a `useEffect`. On the first render that sees a
    // new `brokerId`, the *new* broker was already resolved, but `view.state` could still
    // hold the *previous* broker's snapshot if `useSimulation` didn't guard against it.
    // A module whose `StatePanel` reads a field RabbitMQ's `EngineState` doesn't have
    // (`streams`) throws immediately if handed RabbitMQ's stale state instead of its own.
    const fakeLesson = {
      id: 'only-lesson',
      group: 'basics',
      title: 'Fake lesson',
      summary: 'Minimal, deliberately incompatible module used only to prove a broker '
        + 'switch never hands one module a snapshot it did not produce.',
      topology: {},
      script: [],
      narrative: [{ at: 0, title: 'Fake step', body: 'fake body' }],
      seed: 0,
      durationMs: 1000,
    }

    const fakeBroker: AnyBrokerModule = {
      id: 'fake',
      label: 'Fake',
      lessonGroups: [{ id: 'basics', label: 'Basics' }],
      lessons: [fakeLesson],
      defaultLessonId: 'only-lesson',
      createSimulation: () => {
        let state = { now: 0, seq: 0, rng: { s: 0 }, journal: [], streams: [] as string[] }
        return {
          advanceTo(t: number) {
            state = { ...state, now: t }
          },
          stepOnce() {},
          reset() {
            state = { now: 0, seq: 0, rng: { s: 0 }, journal: [], streams: [] }
          },
          nextEventTime: () => undefined,
          snapshot: () => state,
          issues: [],
        }
      },
      emptyTopology: {},
      nodeTypes: {},
      toNodes: () => [],
      toEdges: () => [],
      inFlight: () => [],
      // RabbitMQ's EngineState has no `streams` field — reading it throws if this
      // component is ever handed RabbitMQ's state instead of its own.
      StatePanel: ({ state }) => <div data-testid="fake-state-panel">{state.streams.length}</div>,
      issueText: () => '',
      metrics: () => ({}),
      NodeConfig: () => null,
    }

    BROKER_CATALOG.push({ id: 'fake', label: 'Fake', defaultLessonId: 'only-lesson' })
    BROKERS.push(fakeBroker)
    try {
      render(<App />)
      expect(() => act(() => useAppStore.getState().setBroker('fake'))).not.toThrow()
      // Proves it's the *new* module's own fresh state (streams: []) that landed on
      // screen, not a stale RabbitMQ snapshot coerced into the new module's shape.
      expect(screen.getByTestId('fake-state-panel').textContent).toBe('0')
    } finally {
      BROKERS.pop()
      BROKER_CATALOG.pop()
    }
  })
})

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
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('tab', { name: 'Diễn giải' }))
    expect(screen.getByTestId('inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-sidebar')).toBeNull()
  })

  it('mobile giữ Transport ở cả ba tab', async () => {
    setViewportWidth(393)
    render(<App />)
    for (const name of ['Bài học', 'Canvas', 'Diễn giải']) {
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

  it('chỉ đúng một broker switcher trên màn hình, ở mọi layout', async () => {
    // TopBar (mobile/tablet) và LessonSidebar đều có thể render BrokerSwitcher —
    // hai nơi cùng sống trên màn hình một lúc là bug (mobile: tab `lessons` luôn
    // hiện cả hai; tablet: mở drawer là hiện cả hai ở 820px).
    setViewportWidth(1280)
    const desktop = render(<App />)
    expect(desktop.getAllByTestId('broker-switcher')).toHaveLength(1)
    desktop.unmount()

    setViewportWidth(393)
    const mobile = render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: 'Bài học' }))
    expect(screen.getByTestId('lesson-sidebar')).toBeInTheDocument()
    expect(screen.getAllByTestId('broker-switcher')).toHaveLength(1)
    mobile.unmount()

    setViewportWidth(820)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Mở danh sách bài học' }))
    expect(screen.getByTestId('lesson-sidebar')).toBeInTheDocument()
    expect(screen.getAllByTestId('broker-switcher')).toHaveLength(1)
  })
})
