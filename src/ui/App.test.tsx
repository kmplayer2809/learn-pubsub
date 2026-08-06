import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

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
    expect(screen.getByTestId('play-pause').textContent).toBe('Play')
  })
})
