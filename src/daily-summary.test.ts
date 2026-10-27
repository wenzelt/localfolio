import { describe, expect, it } from 'vitest'
import { dailySummary } from './daily-summary'

const item = (value: string | null, changePercent: string | null, observedOn: string | null) => ({ value, changePercent, observedOn })

describe('dailySummary', () => {
  it('sums the EUR change and weights the percentage by what the positions were worth the session before', () => {
    expect(dailySummary([
      item('110', '10', '2026-10-21'),
      item('95', '-5', '2026-10-20'),
    ])).toEqual({ change: '5', changePercent: '2.5', date: '2026-10-21', excluded: 0, staleCount: 1, oldestDate: '2026-10-20' })
  })

  it('leaves out positions without a value or a movement and counts them', () => {
    expect(dailySummary([
      item('110', '10', '2026-10-21'),
      item('50', null, '2026-10-21'),
      item(null, '3', null),
    ])).toEqual({ change: '10', changePercent: '10', date: '2026-10-21', excluded: 2, staleCount: 0, oldestDate: '2026-10-21' })
  })

  it('reports a loss as a negative amount and percentage', () => {
    expect(dailySummary([item('90', '-10', '2026-10-21')])).toMatchObject({ change: '-10', changePercent: '-10' })
  })

  it('reports no percentage and no date when nothing can be measured', () => {
    expect(dailySummary([item('50', null, '2026-10-21')])).toEqual({ change: '0', changePercent: null, date: null, excluded: 1, staleCount: 0, oldestDate: null })
    expect(dailySummary([])).toEqual({ change: '0', changePercent: null, date: null, excluded: 0, staleCount: 0, oldestDate: null })
  })

  it('skips a position that fell by 100% instead of dividing by zero', () => {
    expect(dailySummary([item('0', '-100', '2026-10-21')])).toMatchObject({ changePercent: null, excluded: 1 })
  })

  it('counts the holdings still on an earlier session than the newest, as on a Monday before the US open', () => {
    const summary = dailySummary([
      item('110', '10', '2026-10-26'),
      item('105', '5', '2026-10-23'),
      item('95', '-5', '2026-10-22'),
      item('50', null, '2026-10-20'),
    ])
    expect(summary).toMatchObject({ date: '2026-10-26', staleCount: 2, oldestDate: '2026-10-22', excluded: 1 })
  })
})
