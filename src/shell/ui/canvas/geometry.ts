import type { InFlight } from '../../../brokers/rabbitmq/engine'

export function progressOf(flight: InFlight, now: number): number {
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

export const TONE_FILL: Record<string, string> = {
  sky: '#38bdf8',
  emerald: '#34d399',
  rose: '#fb7185',
  amber: '#fbbf24',
}
