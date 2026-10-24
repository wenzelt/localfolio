import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractiveChart } from './chart'
import { chartGeometry, chartPoints, nearestPoint } from './dashboard-view'

const selection = vi.hoisted(() => ({ index: null as number | null, set: vi.fn() }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [selection.index, selection.set],
}))

const series = [
  { date: '2025-01-01', value: '1000', changePercent: '0' },
  { date: '2025-01-02', value: '1100', changePercent: '10' },
  { date: '2025-01-03', value: '1050', changePercent: null },
  { date: '2025-01-04', value: '1250.5', changePercent: '25.05' },
]

type Element = ReactElement<{ children?: ReactNode } & Record<string, unknown>>
type Handler = (event: unknown) => void

function find(node: ReactNode, match: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, match)).find(Boolean)
  if (typeof node !== 'object' || node === null || !('props' in node)) return undefined
  const element = node as Element
  return match(element) ? element : find(element.props.children, match)
}

describe('chart points', () => {
  it('attaches coordinates to plotted observations and skips unavailable returns', () => {
    const points = chartPoints(series, chartGeometry(series, 300, 100))
    expect(points.map((point) => point.date)).toEqual(['2025-01-01', '2025-01-02', '2025-01-04'])
    expect(points.map((point) => point.x)).toEqual([0, 100, 300])
    expect([points[0].y, points[2].y]).toEqual([100, 0])
  })

  it('selects the nearest observation, preferring the earlier one on a tie', () => {
    const points = chartPoints(series, chartGeometry(series, 300, 100))
    expect(nearestPoint(points, 90)).toBe(1)
    expect(nearestPoint(points, 250)).toBe(2)
    expect(nearestPoint(points, -50)).toBe(0)
    expect(nearestPoint(points, 50)).toBe(0)
    expect(nearestPoint([], 10)).toBe(-1)
  })
})

describe('interactive chart', () => {
  beforeEach(() => {
    selection.index = null
    selection.set.mockReset()
  })

  it('describes the latest observation until one is chosen', () => {
    const html = renderToStaticMarkup(<InteractiveChart series={series} tone="positive" />)
    expect(html).toContain('2025-01-04')
    expect(html).toContain('€1,250.50')
    expect(html).toContain('+25.05%')
    expect(html).toMatch(/<input[^>]*type="range"[^>]*aria-label="Select date"/)
    expect(html).toContain('max="2"')
  })

  it('describes the chosen observation and not the interpolated gap', () => {
    selection.index = 1
    const html = renderToStaticMarkup(<InteractiveChart series={series} tone="positive" />)
    expect(html).toContain('2025-01-02')
    expect(html).toContain('€1,100.00')
    expect(html).toContain('+10.00%')
    expect(html).not.toContain('2025-01-03')
  })

  it('masks amounts in the readout and keeps dates and returns when hidden', () => {
    const html = renderToStaticMarkup(<InteractiveChart series={series} tone="positive" hidden />)
    expect(html).not.toContain('€1,250.50')
    expect(html).not.toContain('1250.5')
    expect(html).toContain('Value hidden')
    expect(html).toContain('2025-01-04')
    expect(html).toContain('+25.05%')
  })

  it('chooses the nearest observation under the pointer and clears on leave', () => {
    const chart = InteractiveChart({ series, tone: 'positive' }) as Element
    const svg = find(chart, (element) => element.type === 'svg') as Element
    const move = svg.props.onPointerMove as Handler
    move({ clientX: 500, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) } })
    expect(selection.set).toHaveBeenLastCalledWith(1)
    ;(svg.props.onPointerLeave as Handler)({})
    expect(selection.set).toHaveBeenLastCalledWith(null)
  })

  it('supports touch and keyboard selection and dismissal', () => {
    const chart = InteractiveChart({ series, tone: 'positive' }) as Element
    const svg = find(chart, (element) => element.type === 'svg') as Element
    ;(svg.props.onPointerDown as Handler)({ clientX: 1000, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) } })
    expect(selection.set).toHaveBeenLastCalledWith(2)
    const range = find(chart, (element) => element.type === 'input') as Element
    ;(range.props.onChange as Handler)({ target: { value: '1' } })
    expect(selection.set).toHaveBeenLastCalledWith(1)
    ;(range.props.onKeyDown as Handler)({ key: 'Escape' })
    expect(selection.set).toHaveBeenLastCalledWith(null)
  })

  describe('unit price for a single holding', () => {
    const priced = [
      { date: '2025-01-03', value: '100', changePercent: '0', price: { close: '10', currency: 'EUR' as const, date: '2025-01-03' } },
      { date: '2025-01-04', value: '100', changePercent: '0', price: { close: '10', currency: 'EUR' as const, date: '2025-01-03' } },
      { date: '2025-01-06', value: '125', changePercent: '25', price: { close: '12.5', currency: 'USD' as const, date: '2025-01-06' } },
    ]

    it('shows the labelled price and currency of the latest observation', () => {
      const html = renderToStaticMarkup(<InteractiveChart series={priced} tone="positive" />)
      expect(html).toContain('Price 12.50 USD')
      expect(html).not.toContain('(close')
    })

    it('names the close date when the chosen day has no observation of its own', () => {
      selection.index = 1
      const html = renderToStaticMarkup(<InteractiveChart series={priced} tone="positive" />)
      expect(html).toContain('Price 10.00 EUR (close 2025-01-03)')
    })

    it('masks the price in hide mode', () => {
      const html = renderToStaticMarkup(<InteractiveChart series={priced} tone="positive" hidden />)
      expect(html).not.toContain('12.50')
      expect(html).toContain('Value hidden')
    })

    it('shows no price for the portfolio series or a day without any close', () => {
      expect(renderToStaticMarkup(<InteractiveChart series={series} tone="positive" />)).not.toContain('Price')
      const none = priced.map((day) => ({ ...day, price: null }))
      expect(renderToStaticMarkup(<InteractiveChart series={none} tone="positive" />)).not.toContain('Price')
    })
  })

  it('shows a message and no selector without enough history', () => {
    const html = renderToStaticMarkup(<InteractiveChart series={[]} tone="neutral" />)
    expect(html).toContain('Not enough price history')
    expect(html).not.toContain('type="range"')
  })
})

 describe('chart entrance', () => {
  it('clips only plotted paths for a stable left-to-right reveal, not axes', () => {
    const html = renderToStaticMarkup(<InteractiveChart series={series} tone="positive" />)
    expect(html).toContain('class="chart-reveal"')
    expect(html).toContain('class="chart-endpoint"')
    expect(html).toContain('class="baseline"')
  })
})

describe('chart scale', () => {
  it('draws a faint gridline and a percentage label for each round tick', () => {
    const html = renderToStaticMarkup(<InteractiveChart series={series} tone="positive" />)
    expect(html.match(/<line [^>]*class="grid"/g)).toHaveLength(2)
    expect(html).toMatch(/<text [^>]*class="axis"[^>]*>\+10%<\/text>/)
    expect(html).toMatch(/<text [^>]*class="axis"[^>]*>\+20%<\/text>/)
  })
})
