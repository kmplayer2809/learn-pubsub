import type { InFlight } from '../../kernel/types'

// Only `fromT`/`toT` are read here, so the parameter accepts anything shaped like an
// `InFlight` (including a broker's own richer flight record, e.g. RabbitMQ's
// `AmqpInFlight`) rather than requiring the exact kernel type. Narrowing to `InFlight`
// itself would reject `AmqpInFlight`, whose `message` field carries AMQP-specific
// fields instead of the kernel's `FlightMessage` shape, even though nothing here
// touches `message` at all.
export function progressOf(flight: Pick<InFlight, 'fromT' | 'toT'>, now: number): number {
  const span = flight.toT - flight.fromT
  if (span <= 0) return 1
  const raw = (now - flight.fromT) / span
  return Math.min(1, Math.max(0, raw))
}

export function pointOnPath(path: SVGPathElement, progress: number): { x: number; y: number } {
  const length = path.getTotalLength()
  const point = path.getPointAtLength(length * progress)
  return { x: point.x, y: point.y }
}

/**
 * Màu chấm message bay. Là giá trị `fill`/`stroke` của SVG chứ không phải class
 * Tailwind, nên phải tự tham chiếu CSS var. Đổi theo theme là bắt buộc, không
 * phải trang trí: `sky-400` trên nền canvas sáng `#e2e8f0` chỉ đạt tương phản
 * 1.71, dưới ngưỡng 3:1 cho thành phần đồ hoạ phi văn bản.
 */
export const TONE_FILL: Record<string, string> = {
  sky: 'rgb(var(--tone-sky))',
  emerald: 'rgb(var(--tone-emerald))',
  rose: 'rgb(var(--tone-rose))',
  amber: 'rgb(var(--tone-amber))',
}
