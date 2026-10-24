import { describe, expect, it } from 'vitest'
import { dataFreshness } from './freshness'

const price = (observedOn: string, currency: 'EUR' | 'USD' = 'EUR') => ({ symbol: 'AAA', observedOn, close: '10', currency })
const rate = (date: string) => ({ date, eurPerUsd: '0.9' })

describe('dataFreshness', () => {
  it('reports the latest price date and no problems when data is current', () => {
    expect(dataFreshness({ prices: [price('2025-01-06'), price('2025-01-08')], rates: [], needsFx: false, asOf: '2025-01-09' }))
      .toEqual({ pricesThrough: '2025-01-08', ratesThrough: null, stale: [] })
  })

  it('accepts data seven days old and flags data eight days old', () => {
    expect(dataFreshness({ prices: [price('2025-01-02')], rates: [], needsFx: false, asOf: '2025-01-09' }).stale).toEqual([])
    expect(dataFreshness({ prices: [price('2025-01-01')], rates: [], needsFx: false, asOf: '2025-01-09' }).stale).toEqual(['prices'])
  })

  it('flags unavailable prices as stale with no date', () => {
    expect(dataFreshness({ prices: [], rates: [], needsFx: false, asOf: '2025-01-09' }))
      .toEqual({ pricesThrough: null, ratesThrough: null, stale: ['prices'] })
  })

  it('ignores FX entirely when no holding needs conversion', () => {
    expect(dataFreshness({ prices: [price('2025-01-08')], rates: [rate('2020-01-01')], needsFx: false, asOf: '2025-01-09' }))
      .toMatchObject({ ratesThrough: null, stale: [] })
  })

  it('reports FX date and flags stale FX independently of prices', () => {
    expect(dataFreshness({ prices: [price('2025-01-08', 'USD')], rates: [rate('2024-12-01'), rate('2024-12-20')], needsFx: true, asOf: '2025-01-09' }))
      .toEqual({ pricesThrough: '2025-01-08', ratesThrough: '2024-12-20', stale: ['fx'] })
  })

  it('flags missing FX when conversion is needed', () => {
    expect(dataFreshness({ prices: [price('2025-01-08', 'USD')], rates: [], needsFx: true, asOf: '2025-01-09' }))
      .toEqual({ pricesThrough: '2025-01-08', ratesThrough: null, stale: ['fx'] })
  })

  it('does not depend on input ordering', () => {
    expect(dataFreshness({ prices: [price('2025-01-08'), price('2025-01-06')], rates: [rate('2025-01-08'), rate('2025-01-02')], needsFx: true, asOf: '2025-01-09' }))
      .toEqual({ pricesThrough: '2025-01-08', ratesThrough: '2025-01-08', stale: [] })
  })
})
