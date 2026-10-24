import type { ChangeEvent, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PeriodControl } from './period-control'

const navigation = vi.hoisted(() => ({ push: vi.fn(), pending: false, optimistic: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => '/positions/example',
  useSearchParams: () => new URLSearchParams('period=MAX&account=broker'),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useOptimistic: (value: string) => [value, navigation.optimistic],
  useTransition: () => [navigation.pending, (action: () => void) => action()],
}))

describe('automatic timeframe control', () => {
  beforeEach(() => {
    navigation.push.mockReset()
    navigation.optimistic.mockReset()
    navigation.pending = false
  })

  it('navigates immediately on change and retains other filters and the current path', () => {
    const control = PeriodControl({ period: 'MAX' })
    const children = control.props.children as ReactElement[]
    const select = children.find((child) => child.type === 'select') as ReactElement<{
      onChange: (event: ChangeEvent<HTMLSelectElement>) => void
    }>
    select.props.onChange({ target: { value: 'YTD' } } as ChangeEvent<HTMLSelectElement>)
    expect(navigation.optimistic).toHaveBeenCalledExactlyOnceWith('YTD')
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/positions/example?period=YTD&account=broker')
  })

  it('renders all timeframe choices and only offers Apply as a no-script fallback', () => {
    const html = renderToStaticMarkup(<PeriodControl period="YTD" />)
    expect(html.match(/<option /g)).toHaveLength(5)
    expect(html).toContain('value="YTD" selected=""')
    expect(html).toMatch(/<noscript><button type="submit">Apply<\/button><\/noscript>/)
    expect(html).toContain('name="account" value="broker"')
  })

  it('announces loading without disabling further timeframe changes', () => {
    navigation.pending = true
    const html = renderToStaticMarkup(<PeriodControl period="MAX" />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('<span class="spinner" aria-hidden="true">')
    expect(html).toContain('<span class="sr-only">Updating</span>')
    expect(html).not.toContain('disabled')
  })

  it('always reserves the spinner slot so nothing moves while loading', () => {
    const idle = renderToStaticMarkup(<PeriodControl period="MAX" />)
    expect(idle).toContain('<span role="status" class="period-status"></span>')
    expect(idle).not.toMatch(/Updating|spinner/)
    navigation.pending = true
    const busy = renderToStaticMarkup(<PeriodControl period="MAX" />)
    expect(busy).toContain('role="status" class="period-status"')
    expect(busy).not.toContain('Updating…')
  })
})
