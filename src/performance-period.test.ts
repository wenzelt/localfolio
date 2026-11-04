import { describe, expect, it } from 'vitest'
import { performanceStart } from './performance-period'

describe('performance period boundaries', () => {
  it.each([
    ['MAX', '2025-02-05', '2022-01-03'],
    ['1Y', '2025-02-05', '2024-02-05'],
    ['YTD', '2025-02-05', '2025-01-01'],
    ['MTD', '2025-02-05', '2025-02-01'],
    ['WTD', '2025-02-05', '2025-02-03'],
    ['1D', '2025-02-05', '2025-02-05'],
    ['WTD', '2025-01-12', '2025-01-06'],
    ['WTD', '2025-01-06', '2025-01-06'],
    ['1Y', '2024-02-29', '2023-02-28'],
    ['1M', '2025-02-05', '2025-01-05'],
    ['1M', '2025-03-31', '2025-02-28'],
    ['3M', '2025-02-05', '2024-11-05'],
    ['3M', '2025-05-31', '2025-02-28'],
    ['6M', '2025-02-05', '2024-08-05'],
    ['6M', '2025-08-31', '2025-02-28'],
  ] as const)('%s on %s starts at %s', (period, asOf, expected) => {
    expect(performanceStart(period, asOf, '2022-01-03')).toBe(expected)
  })

  it.each([
    ['2025-02-05', '2020-02-05'],
    ['2024-02-29', '2019-02-28'],
  ])('5Y on %s starts at %s', (asOf, expected) => {
    expect(performanceStart('5Y', asOf, '2015-01-03')).toBe(expected)
  })

  it('never starts before the first activity', () => {
    expect(performanceStart('YTD', '2025-02-05', '2025-02-01')).toBe('2025-02-01')
  })

  it('returns no start when there are no past activities', () => {
    expect(performanceStart('MAX', '2025-02-05', null)).toBeNull()
    expect(performanceStart('MAX', '2025-02-05', '2025-02-06')).toBeNull()
  })

  it('rejects invalid dates and unsupported periods', () => {
    expect(() => performanceStart('MAX', '2025-02-30', null)).toThrow('Invalid performance date')
    expect(() => performanceStart('MAX', 'not-a-date', null)).toThrow('Invalid performance date')
    expect(() => performanceStart('WEEK' as never, '2025-02-05', null)).toThrow('Unsupported period')
  })
})
