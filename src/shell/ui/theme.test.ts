import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, readStoredTheme, resolveInitialTheme } from './theme'

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') && prefersDark,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('đọc giá trị đã lưu', () => {
    localStorage.setItem('theme', 'light')
    expect(readStoredTheme()).toBe('light')
  })

  it('bỏ qua giá trị rác trong localStorage', () => {
    localStorage.setItem('theme', 'neon')
    expect(readStoredTheme()).toBeNull()
  })

  it('trả null khi localStorage ném lỗi (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(readStoredTheme()).toBeNull()
  })

  it('giá trị đã lưu thắng prefers-color-scheme', () => {
    mockMatchMedia(true)
    localStorage.setItem('theme', 'light')
    expect(resolveInitialTheme()).toBe('light')
  })

  it('không có giá trị lưu thì theo prefers-color-scheme', () => {
    mockMatchMedia(true)
    expect(resolveInitialTheme()).toBe('dark')
    mockMatchMedia(false)
    expect(resolveInitialTheme()).toBe('light')
  })

  it('applyTheme ghi data-theme và localStorage', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('applyTheme vẫn set data-theme khi localStorage ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => applyTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
