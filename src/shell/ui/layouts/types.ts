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
