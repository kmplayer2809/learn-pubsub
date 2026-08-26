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
