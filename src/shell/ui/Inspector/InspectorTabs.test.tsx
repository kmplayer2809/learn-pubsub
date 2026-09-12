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
// `Lesson<T, A>` (the shared shape `AnyBrokerModule` exposes) has no `failures` field —
// it lives only on each broker's own extended lesson type (see e.g.
// `src/brokers/rabbitmq/lessons/types.ts`). `useSimulation.ts` reads it through the same
// cast for the same reason.
const state = broker
  .createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: (lesson as { failures?: unknown[] }).failures,
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
