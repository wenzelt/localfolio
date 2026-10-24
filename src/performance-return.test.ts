import { describe, expect, it } from 'vitest'
import { performanceReturn } from './performance-return'

describe('Modified Dietz return', () => {
  it('measures gain against opening capital without flows', () => {
    expect(performanceReturn('100', '120', '2025-01-01', '2025-01-10', [])).toEqual({ change: '20', changePercent: '20' })
  })

  it('weights a flow by the calendar days it is held, counting the day it arrives', () => {
    const result = performanceReturn('100', '240', '2025-01-01', '2025-01-10', [{ date: '2025-01-05', amount: '100' }])
    expect(result.change).toBe('40')
    expect(Number(result.changePercent)).toBeCloseTo(40 / 160 * 100, 10)
  })

  it('subtracts withdrawals as negative flows', () => {
    const result = performanceReturn('100', '60', '2025-01-01', '2025-01-10', [{ date: '2025-01-10', amount: '-59' }])
    expect(result.change).toBe('19')
    expect(Number(result.changePercent)).toBeCloseTo(19 / 94.1 * 100, 10)
  })

  it('gives a first-day flow full weight and excludes future and prior flows', () => {
    const result = performanceReturn('0', '120', '2025-01-01', '2025-01-10', [
      { date: '2024-12-31', amount: '1000' },
      { date: '2025-01-01', amount: '100' },
      { date: '2025-01-11', amount: '1000' },
    ])
    expect(result).toEqual({ change: '20', changePercent: '20' })
  })

  it('returns null when weighted invested capital is zero or negative', () => {
    expect(performanceReturn('0', '0', '2025-01-01', '2025-01-01', []).changePercent).toBeNull()
    expect(performanceReturn('10', '0', '2025-01-01', '2025-01-10', [{ date: '2025-01-01', amount: '-20' }]).changePercent).toBeNull()
  })

  it('keeps decimal arithmetic exact', () => {
    expect(performanceReturn('0.1', '0.3', '2025-01-01', '2025-01-01', [])).toEqual({ change: '0.2', changePercent: '200' })
  })

  it('preserves negative returns', () => {
    expect(performanceReturn('100', '80', '2025-01-01', '2025-01-10', [])).toEqual({ change: '-20', changePercent: '-20' })
  })
})
