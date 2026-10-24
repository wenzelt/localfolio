import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveRefresh, refreshUnlessBusy, startPolling, updatedLabel } from './live-refresh'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function fakeDocument() {
  const target = new EventTarget()
  return Object.assign(target, { visibilityState: 'visible' as 'visible' | 'hidden' })
}

describe('polling for fresh data', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('refreshes on every interval while the tab is visible', () => {
    const refresh = vi.fn()
    startPolling(refresh, 60, fakeDocument())
    vi.advanceTimersByTime(59_000)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(120_000)
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it('skips ticks while the tab is hidden and refreshes as soon as it is shown again', () => {
    const refresh = vi.fn()
    const page = fakeDocument()
    startPolling(refresh, 60, page)
    page.visibilityState = 'hidden'
    page.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(300_000)
    expect(refresh).not.toHaveBeenCalled()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stops refreshing once stopped', () => {
    const refresh = vi.fn()
    const page = fakeDocument()
    const stop = startPolling(refresh, 60, page)
    stop()
    vi.advanceTimersByTime(300_000)
    page.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('update label', () => {
  const now = new Date('2026-03-20T15:00:00')

  it('shows only the time for a fetch earlier today', () => {
    expect(updatedLabel(new Date('2026-03-20T14:32:00').toISOString(), now)).toBe(
      new Date('2026-03-20T14:32:00').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  })

  it('adds the day for an older fetch, such as over a weekend', () => {
    const label = updatedLabel(new Date('2026-03-18T22:05:00').toISOString(), now)
    expect(label).toBe(new Date('2026-03-18T22:05:00').toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    expect(label).toContain('18')
  })

  it('has no label without a fetch time', () => {
    expect(updatedLabel(null, now)).toBe('')
  })
})

describe('live refresh indicator', () => {
  it('renders an empty marker on the server, where the viewer time zone is unknown', () => {
    expect(renderToStaticMarkup(<LiveRefresh fetchedAt="2026-03-20T14:32:00.000Z" />)).toBe('<span data-live-refresh=""></span>')
  })
})

describe('refresh guard', () => {
  it('starts a refresh inside the transition when none is running', () => {
    const refresh = vi.fn()
    const startTransition = vi.fn((work: () => void) => work())
    refreshUnlessBusy(false, startTransition, refresh)
    expect(startTransition).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('skips the tick while the previous refresh is still pending', () => {
    const refresh = vi.fn()
    const startTransition = vi.fn((work: () => void) => work())
    refreshUnlessBusy(true, startTransition, refresh)
    expect(startTransition).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
