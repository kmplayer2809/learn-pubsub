import { useEffect, useState } from 'react'
import type { EngineState } from '../../engine'
import { pointOnPath, progressOf, TONE_FILL } from './geometry'

interface Particle {
  key: string
  x: number
  y: number
  tone: string
}

/**
 * Draws in-flight messages above the React Flow pane. Positions are derived
 * from virtual time, so pause and rewind need no special handling here.
 */
export function MessageLayer({ state }: { state: EngineState }) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [transform, setTransform] = useState('none')

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    setTransform(viewport?.style.transform || 'none')

    const next: Particle[] = []
    for (const flight of state.inFlight) {
      const selector = `.react-flow__edge[data-id="${flight.edgeId}"] path.react-flow__edge-path`
      const path = document.querySelector<SVGPathElement>(selector)
      if (!path) continue
      const { x, y } = pointOnPath(path, progressOf(flight, state.now))
      next.push({ key: `${flight.messageId}@${flight.edgeId}`, x, y, tone: flight.tone })
    }
    setParticles(next)
  }, [state])

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-testid="message-layer"
    >
      <g style={{ transform, transformOrigin: '0 0' }}>
        {particles.map((p) => (
          <g key={p.key}>
            <circle cx={p.x} cy={p.y} r={9} fill={TONE_FILL[p.tone] ?? '#94a3b8'} opacity={0.25} />
            <circle cx={p.x} cy={p.y} r={5} fill={TONE_FILL[p.tone] ?? '#94a3b8'} />
          </g>
        ))}
      </g>
    </svg>
  )
}
