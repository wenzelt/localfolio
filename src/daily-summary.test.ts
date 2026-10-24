import { describe, expect, it } from 'vitest'
import { dailySummary } from './daily-summary'

const item = (value: string | null, changePercent: string | null, observedOn: string | null) => ({ value, changePercent, observedOn })

describe('dailySummary', () => {
  it('sums the EUR change and weights the percentage by what the positions were worth the session before', () => {
    expect(dailySummary([
      item('110', '10', '2026-10-21'),
      item('95', '-5', '2026-10-20'),
    ])).toEqual({ change: '5', changePercent: '2.5', date: '2026-10-21', excluded: 0 })
  })

  it('leaves out positions without a value or a movement and counts them', () => {
    expect(dailySummary([
      item('110', '10', '2026-10-21'),
      item('50', null, '2026-10-21'),
      item(null, '3', null),
    ])).toEqual({ change: '10', changePercent: '10', date: '2026-10-21', excluded: 2 })
  })

  it('reports a loss as a negative amount and percentage', () => {
    expect(dailySummary([item('90', '-10', '2026-10-21')])).toMatchObject({ change: '-10', changePercent: '-10' })
  })

  it('reports no percentage and no date when nothing can be measured', () => {
    expect(dailySummary([item('50', null, '2026-10-21')])).toEqual({ change: '0', changePercent: null, date: null, excluded: 1 })
    expect(dailySummary([])).toEqual({ change: '0', changePercent: null, date: null, excluded: 0 })
  })

  it('skips a position that fell by 100% instead of dividing by zero', () => {
    expect(dailySummary([item('0', '-100', '2026-10-21')])).toMatchObject({ changePercent: null, excluded: 1 })
  })
})
