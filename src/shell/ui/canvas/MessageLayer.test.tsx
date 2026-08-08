import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { InFlight } from '../../kernel/types'
import { MessageLayer } from './MessageLayer'

const message = { id: 'm1', solid: false }

// jsdom implements no SVG geometry at all: there is no real SVGPathElement
// constructor (SVG tags come back as plain SVGElement), and getTotalLength /
// getPointAtLength don't exist. Interpolation arithmetic itself is covered
// thoroughly (and DOM-free) by geometry.test.ts; this file only smoke-tests
// that the component wires the DOM lookup and rendering together, so each
// test stubs geometry methods directly on the mocked path instance.
function stubPathGeometry(selector: string): void {
  const path = document.querySelector(selector)
  if (!path) throw new Error(`test setup: no element for ${selector}`)
  Object.defineProperties(path, {
    getTotalLength: { value: () => 100, configurable: true },
    getPointAtLength: {
      value: (length: number) => ({ x: length, y: length / 2 }),
      configurable: true,
    },
  })
}

describe('MessageLayer', () => {
  it('places a particle at the interpolated point on its edge path', async () => {
    document.body.innerHTML = `
      <div class="react-flow__viewport" style="transform: translate(10px, 20px) scale(1)">
        <div class="react-flow__edge" data-id="a->b">
          <path class="react-flow__edge-path" />
        </div>
      </div>
    `
    stubPathGeometry('.react-flow__edge[data-id="a->b"] path.react-flow__edge-path')

    const flights: InFlight[] = [{ message, edgeId: 'a->b', fromT: 1000, toT: 1600, tone: 'sky' }]

    const { container } = render(<MessageLayer flights={flights} now={1300} />)

    // progress = 0.5 -> length 100 * 0.5 = 50 -> stub returns {x:50, y:25}
    await waitFor(() => {
      expect(container.querySelector('circle[cx="50"][cy="25"]')).not.toBeNull()
    })
    const group = container.querySelector('g[style*="translate(10px, 20px) scale(1)"]')
    expect(group).not.toBeNull()
  })

  it('follows the viewport transform when it changes with no new flights (pan/zoom while paused)', async () => {
    document.body.innerHTML = `
      <div class="react-flow__viewport" style="transform: translate(0px, 0px) scale(1)">
        <div class="react-flow__edge" data-id="a->b">
          <path class="react-flow__edge-path" />
        </div>
      </div>
    `
    stubPathGeometry('.react-flow__edge[data-id="a->b"] path.react-flow__edge-path')

    // Same flights array reused below to prove the overlay reacts to the viewport
    // itself, not to a new flights array (the app never produces one while paused,
    // which is exactly when a user pans/zooms to inspect).
    const flights: InFlight[] = [{ message, edgeId: 'a->b', fromT: 1000, toT: 1600, tone: 'sky' }]

    const { container } = render(<MessageLayer flights={flights} now={1300} />)

    await waitFor(() => {
      expect(container.querySelector('g[style*="translate(0px, 0px) scale(1)"]')).not.toBeNull()
    })

    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('test setup: viewport missing')
    viewport.style.transform = 'translate(200px, 75px) scale(2)'

    await waitFor(() => {
      expect(container.querySelector('g[style*="translate(200px, 75px) scale(2)"]')).not.toBeNull()
    })
  })

  it('draws a transient message hollow and a solid one filled', async () => {
    document.body.innerHTML = `
      <div class="react-flow__viewport" style="transform: translate(0px, 0px) scale(1)">
        <div class="react-flow__edge" data-id="a->b">
          <path class="react-flow__edge-path" />
        </div>
        <div class="react-flow__edge" data-id="c->d">
          <path class="react-flow__edge-path" />
        </div>
      </div>
    `
    stubPathGeometry('.react-flow__edge[data-id="a->b"] path.react-flow__edge-path')
    stubPathGeometry('.react-flow__edge[data-id="c->d"] path.react-flow__edge-path')

    const transient = { id: 'm2', solid: false }
    const solid = { id: 'm3', solid: true }
    const flights: InFlight[] = [
      { message: transient, edgeId: 'a->b', fromT: 1000, toT: 1600, tone: 'sky' },
      { message: solid, edgeId: 'c->d', fromT: 1000, toT: 1600, tone: 'sky' },
    ]

    const { container } = render(<MessageLayer flights={flights} now={1300} />)

    await waitFor(() => {
      expect(container.querySelectorAll('circle')).not.toHaveLength(0)
    })
    const hollow = container.querySelector('circle[fill="none"]')
    expect(hollow).not.toBeNull()
    expect(hollow?.getAttribute('stroke')).not.toBeNull()

    // The solid particle's inner circle is filled, not hollow — only one
    // `fill="none"` circle should exist across both particles.
    expect(container.querySelectorAll('circle[fill="none"]')).toHaveLength(1)
  })

  it('skips a particle silently when its edge path is not yet painted', async () => {
    document.body.innerHTML = '' // React Flow has not rendered any edges yet
    const flights: InFlight[] = [{ message, edgeId: 'nowhere->else', fromT: 1000, toT: 1600, tone: 'sky' }]

    let container: HTMLElement | undefined
    expect(() => {
      container = render(<MessageLayer flights={flights} now={1300} />).container
    }).not.toThrow()

    await waitFor(() => {
      expect(container?.querySelectorAll('circle').length).toBe(0)
    })
  })
})
