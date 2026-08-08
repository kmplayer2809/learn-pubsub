import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getBroker } from '../../brokers/registry'
import { useSandboxStore } from '../../brokers/rabbitmq/sandbox/sandboxStore'
import { useAppStore } from '../store'
import App from './App'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSandboxStore.getState().reset()
})

/** Ids of the canvas nodes currently wearing the narrative-highlight outline. */
function highlightedNodeIds(): string[] {
  return [...document.querySelectorAll('.outline-fuchsia-400')]
    .map((el) => el.closest('.react-flow__node')?.getAttribute('data-id') ?? '')
    .sort()
}

describe('App', () => {
  it('renders all three columns with the first lesson selected', () => {
    render(<App />)
    expect(screen.getByTestId('lesson-sidebar')).toBeTruthy()
    expect(screen.getByTestId('canvas')).toBeTruthy()
    expect(screen.getByTestId('inspector')).toBeTruthy()
    expect(screen.getByText('Hello world')).toBeTruthy()
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
    render(<App />)
    expect(screen.getByTestId('inflight-panel')).toBeTruthy()
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
})
