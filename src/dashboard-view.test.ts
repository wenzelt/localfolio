import { describe, expect, it } from 'vitest'
import { chartAccent, chartGeometry, chartTicks, formatEur, formatPercent, parsePeriod, PERIODS, tone } from './dashboard-view'

describe('period choices', () => {
  it('offers the five chart periods in dropdown order', () => {
    expect(PERIODS).toEqual([
      { value: 'MAX', label: 'Max' },
      { value: '1Y', label: '1 year' },
      { value: 'YTD', label: 'Year to date' },
      { value: 'MTD', label: 'Month to date' },
      { value: 'WTD', label: 'Week to date' },
    ])
  })

  it('parses a known period and falls back to Max', () => {
    expect(parsePeriod('YTD')).toBe('YTD')
    expect(parsePeriod('1D')).toBe('MAX')
    for (const value of [undefined, '', 'ytd', 'ALL', '1Y; DROP']) expect(parsePeriod(value)).toBe('MAX')
  })
})

describe('number formatting', () => {
  it('formats EUR amounts with grouping and two decimals', () => {
    expect(formatEur('1234.5')).toBe('€1,234.50')
    expect(formatEur('0')).toBe('€0.00')
    expect(formatEur('-12.5')).toBe('-€12.50')
  })

  it('formats percentages with an explicit sign and two decimals', () => {
    expect(formatPercent('12.3456')).toBe('+12.35%')
    expect(formatPercent('-3.2')).toBe('-3.20%')
    expect(formatPercent('0')).toBe('0.00%')
    expect(formatPercent('-0.001')).toBe('0.00%')
  })

  it('shows a dash when there is no percentage', () => {
    expect(formatPercent(null)).toBe('–')
  })

  it('colours by the sign of the rounded value', () => {
    expect(tone('0.01')).toBe('positive')
    expect(tone('-0.01')).toBe('negative')
    expect(tone('0')).toBe('neutral')
    expect(tone('-0.001')).toBe('neutral')
    expect(tone(null)).toBe('neutral')
  })
})

describe('chart geometry', () => {
  const point = (changePercent: string | null) => ({ date: '2025-01-01', value: '0', changePercent })

  it('scales days across the width and percentages onto the height, top being the highest', () => {
    expect(chartGeometry([point('0'), point('10'), point('5')], 200, 100)).toEqual({
      path: 'M0 100L100 0L200 50',
      zeroY: 100,
    })
  })

  it('keeps the zero line inside the chart when values are negative', () => {
    expect(chartGeometry([point('-10'), point('10')], 100, 100)).toEqual({ path: 'M0 100L100 0', zeroY: 50 })
  })

  it('always includes zero in the range', () => {
    expect(chartGeometry([point('4'), point('4')], 100, 100)).toEqual({ path: 'M0 0L100 0', zeroY: 100 })
  })

  it('skips days without a percentage but keeps the spacing', () => {
    expect(chartGeometry([point('0'), point(null), point('10')], 100, 100).path).toBe('M0 100L100 0')
  })

  it('centres an all-zero series without dividing by zero', () => {
    expect(chartGeometry([point('0'), point('0')], 100, 100)).toEqual({ path: 'M0 50L100 50', zeroY: 50 })
  })

  it('has nothing to draw for no data', () => {
    expect(chartGeometry([], 100, 100)).toEqual({ path: '', zeroY: null })
    expect(chartGeometry([point(null)], 100, 100)).toEqual({ path: '', zeroY: null })
  })
})

describe('chart accent', () => {
  const point = (changePercent: string) => ({ changePercent })

  it('closes the line down to the zero baseline for the area and marks the last point', () => {
    expect(chartAccent(chartGeometry([point('0'), point('10'), point('5')], 200, 100))).toEqual({
      area: 'M0 100L100 0L200 50L200 100L0 100Z',
      end: { x: 200, y: 50 },
    })
  })

  it('handles a single point', () => {
    expect(chartAccent(chartGeometry([point('4')], 100, 100))).toEqual({ area: 'M0 0L0 100L0 100Z', end: { x: 0, y: 0 } })
  })

  it('has no area or marker without data', () => {
    expect(chartAccent({ path: '', zeroY: null })).toEqual({ area: '', end: null })
  })
})

describe('chart ticks', () => {
  const point = (changePercent: string | null) => ({ changePercent })

  it('places round percentages on the same scale as the line, leaving zero to the baseline', () => {
    const ticks = chartTicks([point('0'), point('25.05')], 280)
    expect(ticks.map((tick) => tick.percent)).toEqual([10, 20])
    expect(ticks[0].y).toBeCloseTo(((25.05 - 10) / 25.05) * 280, 1)
  })

  it('covers losses as well as gains', () => {
    expect(chartTicks([point('-10'), point('10')], 100).map((tick) => tick.percent)).toEqual([-10, -5, 5, 10])
  })

  it('has no scale for a flat or empty series', () => {
    expect(chartTicks([point('0'), point('0')], 100)).toEqual([])
    expect(chartTicks([], 100)).toEqual([])
    expect(chartTicks([point(null)], 100)).toEqual([])
  })
})
