import { useEffect, useLayoutEffect, useState } from 'react'
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

  // React Flow's viewport transform changes on pan/zoom without producing a
  // new EngineState (most importantly, while the simulation is paused - the
  // exact moment a user pans/zooms to inspect what's happening). This effect
  // is intentionally independent of `state` so it can't go stale: it reads
  // the viewport once on mount and then reacts to the DOM itself changing,
  // rather than polling or waiting for a tick that may never come.
  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) return

    setTransform(viewport.style.transform || 'none')

    const observer = new MutationObserver(() => {
      setTransform(viewport.style.transform || 'none')
    })
    observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])

  // useLayoutEffect (not useEffect): this reads already-painted DOM (edge
  // path geometry) and writes particle positions that must appear in the
  // same frame as the nodes/edges they're tracking. useEffect would defer
  // this to a second, post-paint pass - particles visibly lagging the nodes
  // by one frame and forcing an extra render each animation-frame tick.
  useLayoutEffect(() => {
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
