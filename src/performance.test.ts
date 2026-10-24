import { describe, expect, it } from 'vitest'
import { calculatePerformance } from './performance'
import type { PerformanceActivity, RateRow } from './performance'
import type { PerformancePeriod } from './performance-period'
import type { HistoricalPrice } from './price-history'

function trade(type: 'BUY' | 'SELL', date: string, symbol: string, quantity: string, unitPrice: string, extra: Partial<PerformanceActivity> = {}): PerformanceActivity {
  return { type, date, symbol, quantity, unitPrice, fee: '0', currency: 'EUR', ...extra }
}
const buy = (date: string, symbol: string, quantity: string, unitPrice: string, extra: Partial<PerformanceActivity> = {}) => trade('BUY', date, symbol, quantity, unitPrice, extra)
const sell = (date: string, symbol: string, quantity: string, unitPrice: string, extra: Partial<PerformanceActivity> = {}) => trade('SELL', date, symbol, quantity, unitPrice, extra)

function closes(symbol: string, currency: 'EUR' | 'USD', ...pairs: [string, string][]): HistoricalPrice[] {
  return pairs.map(([observedOn, close]) => ({ symbol, observedOn, close, currency }))
}

function daily(symbol: string, from: string, to: string, closeOn: (date: string) => string): HistoricalPrice[] {
  const result: HistoricalPrice[] = []
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86_400_000) {
    const observedOn = new Date(time).toISOString().slice(0, 10)
    result.push({ symbol, observedOn, close: closeOn(observedOn), currency: 'EUR' })
  }
  return result
}

const AAA = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-07', '11'], ['2025-01-08', '12'])

function run(activities: PerformanceActivity[], prices: HistoricalPrice[], period: PerformancePeriod, asOf: string, rates: RateRow[] = []) {
  return calculatePerformance({ activities, prices, rates }, asOf, period)
}

describe('calculatePerformance value and change', () => {
  it('reports value, change and percentage over the whole history', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], AAA, 'MAX', '2025-01-08')
    expect(result).toMatchObject({ period: 'MAX', from: '2025-01-06', to: '2025-01-08', value: '120', change: '20', changePercent: '20', unpriced: [] })
  })

  it('returns one series point per calendar day with the percentage so far', () => {
    const { series } = run([buy('2025-01-06', 'AAA', '10', '10')], AAA, 'MAX', '2025-01-08')
    expect(series).toEqual([
      { date: '2025-01-06', value: '100', changePercent: '0' },
      { date: '2025-01-07', value: '110', changePercent: '10' },
      { date: '2025-01-08', value: '120', changePercent: '20' },
    ])
  })

  it('does not count additional purchases as performance', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), buy('2025-01-08', 'AAA', '10', '12')], AAA, 'MAX', '2025-01-08')
    expect(result).toMatchObject({ value: '240', change: '20' })
    expect(Number(result.changePercent)).toBeCloseTo(20 / 140 * 100, 8)
  })

  it('subtracts sale proceeds net of fees from the flows', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), sell('2025-01-08', 'AAA', '5', '12', { fee: '1' })], AAA, 'MAX', '2025-01-08')
    expect(result).toMatchObject({ value: '60', change: '19' })
    expect(Number(result.changePercent)).toBeCloseTo(19 / (100 - 59 / 3) * 100, 8)
  })

  it('includes purchase fees in the invested flow', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10', { fee: '2' })], AAA, 'MAX', '2025-01-08')
    expect(result.change).toBe('18')
    expect(Number(result.changePercent)).toBeCloseTo(18 / 102 * 100, 8)
  })

  it('sums several symbols', () => {
    const prices = [...AAA, ...closes('BBB', 'EUR', ['2025-01-06', '5'], ['2025-01-07', '6'])]
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), buy('2025-01-06', 'BBB', '4', '5')], prices, 'MAX', '2025-01-07')
    expect(result).toMatchObject({ value: '134', change: '14' })
    expect(Number(result.changePercent)).toBeCloseTo(14 / 120 * 100, 8)
  })

  it('carries the last close over days without a price', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-08', '12'])
    const { series } = run([buy('2025-01-06', 'AAA', '10', '10')], prices, 'MAX', '2025-01-08')
    expect(series.map((point) => point.value)).toEqual(['100', '100', '120'])
  })

  it('converts USD trades and prices with the cached rates', () => {
    const prices = closes('USD1', 'USD', ['2025-01-06', '10'], ['2025-01-07', '11'], ['2025-01-08', '12'])
    const rates = [{ date: '2025-01-06', eurPerUsd: '0.9' }, { date: '2025-01-08', eurPerUsd: '0.95' }]
    const result = run([buy('2025-01-06', 'USD1', '10', '10', { currency: 'USD' })], prices, 'MAX', '2025-01-08', rates)
    expect(result).toMatchObject({ value: '114', change: '24' })
    expect(Number(result.changePercent)).toBeCloseTo(24 / 90 * 100, 8)
    expect(result.series[1].value).toBe('99')
  })

  it('values a closed position at zero without needing later prices', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-07', '11'])
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), sell('2025-01-07', 'AAA', '10', '11')], prices, 'MAX', '2025-01-20')
    expect(result).toMatchObject({ value: '0', change: '10', changePercent: null, unpriced: [] })
  })

  it('lets a buy and sell on the same day net out', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'])
    const result = run([sell('2025-01-06', 'AAA', '10', '10'), buy('2025-01-06', 'AAA', '10', '10')], prices, 'MAX', '2025-01-06')
    expect(result).toMatchObject({ value: '0', change: '0', changePercent: null })
  })

  it('rejects selling more than is held', () => {
    expect(() => run([sell('2025-01-06', 'AAA', '1', '10')], AAA, 'MAX', '2025-01-08')).toThrow('Sold more than held')
  })

  it('returns an empty result before the first trade', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], AAA, 'MAX', '2025-01-05')
    expect(result).toEqual({ period: 'MAX', from: null, to: '2025-01-05', value: '0', change: '0', changePercent: null, series: [], unpriced: [] })
  })

  it('returns an empty result without activities', () => {
    expect(run([], [], 'MAX', '2025-01-05')).toMatchObject({ from: null, value: '0', series: [] })
  })

  it('rejects invalid dates and unsupported periods', () => {
    expect(() => run([], [], 'MAX', '2025-02-30')).toThrow('Invalid performance date')
    expect(() => run([], [], 'WEEK' as never, '2025-02-03')).toThrow('Unsupported period')
  })

  it('accepts full ISO timestamps on activities', () => {
    const result = run([buy('2025-01-06T10:00:00.000Z', 'AAA', '10', '10')], AAA, 'MAX', '2025-01-08')
    expect(result.value).toBe('120')
  })
})

describe('calculatePerformance periods', () => {
  const long = daily('AAA', '2022-01-03', '2025-03-01', () => '10')
  const first = [buy('2022-01-03', 'AAA', '1', '10')]

  it('starts each period on the boundary chosen by performanceStart', () => {
    expect(run(first, long, '1D', '2025-02-05').from).toBe('2025-02-05')
    expect(run(first, long, 'WTD', '2025-02-05').from).toBe('2025-02-03')
    expect(run(first, long, 'MTD', '2025-02-05').from).toBe('2025-02-01')
    expect(run(first, long, 'YTD', '2025-02-05').from).toBe('2025-01-01')
    expect(run(first, long, '1Y', '2025-03-01').from).toBe('2024-03-01')
    expect(run(first, long, 'MAX', '2025-03-01').from).toBe('2022-01-03')
  })

  it('never starts before the first trade', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], AAA, 'YTD', '2025-01-08')
    expect(result).toMatchObject({ from: '2025-01-06', changePercent: '20' })
  })

  it('compares 1D with the previous calendar day', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], AAA, '1D', '2025-01-08')
    expect(result).toMatchObject({ from: '2025-01-08', value: '120', change: '10' })
    expect(Number(result.changePercent)).toBeCloseTo(10 / 110 * 100, 8)
    expect(result.series).toHaveLength(1)
  })

  it('shows no change on a weekend day after Friday', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-10', '13'])
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], prices, '1D', '2025-01-12')
    expect(result).toMatchObject({ value: '130', change: '0', changePercent: '0' })
  })

  it('measures the week from the value before Monday', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-02', '10'], ['2025-01-03', '10'], ['2025-01-06', '11'], ['2025-01-07', '12'], ['2025-01-08', '13'])
    const result = run([buy('2025-01-02', 'AAA', '10', '10')], prices, 'WTD', '2025-01-08')
    expect(result).toMatchObject({ from: '2025-01-06', value: '130', change: '30', changePercent: '30' })
    expect(result.series.map((point) => point.date)).toEqual(['2025-01-06', '2025-01-07', '2025-01-08'])
  })

  it('measures the month from the value on the last day of the previous month', () => {
    const prices = daily('AAA', '2025-01-20', '2025-02-05', (date) => date < '2025-02-01' ? '12' : '15')
    const result = run([buy('2025-01-20', 'AAA', '10', '12')], prices, 'MTD', '2025-02-05')
    expect(result).toMatchObject({ from: '2025-02-01', change: '30', changePercent: '25' })
  })

  it('measures the year to date from the value on 31 December', () => {
    const prices = daily('AAA', '2024-12-20', '2025-02-05', (date) => date < '2025-01-01' ? '12' : '15')
    const result = run([buy('2024-12-20', 'AAA', '10', '12')], prices, 'YTD', '2025-02-05')
    expect(result).toMatchObject({ from: '2025-01-01', change: '30', changePercent: '25' })
  })

  it('measures one year from the value before the start date', () => {
    const prices = daily('AAA', '2023-01-01', '2025-03-01', (date) => date < '2024-03-01' ? '10' : '20')
    const result = run([buy('2023-01-01', 'AAA', '10', '10')], prices, '1Y', '2025-03-01')
    expect(result).toMatchObject({ from: '2024-03-01', change: '100', changePercent: '100' })
  })
})

describe('calculatePerformance unpriced positions', () => {
  it('excludes a symbol without prices and names it', () => {
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), buy('2025-01-06', 'GONE', '5', '1')], AAA, 'MAX', '2025-01-08')
    expect(result).toMatchObject({ value: '120', change: '20', changePercent: '20', unpriced: ['GONE'] })
  })

  it('excludes a USD trade without a rate on or before its date', () => {
    const prices = closes('USD1', 'USD', ['2025-01-06', '10'])
    const rates = [{ date: '2025-01-07', eurPerUsd: '0.9' }]
    const result = run([buy('2025-01-06', 'USD1', '1', '10', { currency: 'USD' })], prices, 'MAX', '2025-01-08', rates)
    expect(result).toMatchObject({ from: null, value: '0', unpriced: ['USD1'] })
  })

  it('excludes a USD-priced symbol whose rate is too old for a held day', () => {
    const prices = closes('USD1', 'USD', ['2025-01-06', '10'], ['2025-01-07', '10'])
    const rates = [{ date: '2024-12-01', eurPerUsd: '0.9' }]
    const result = run([buy('2025-01-06', 'USD1', '1', '10')], prices, 'MAX', '2025-01-07', rates)
    expect(result.unpriced).toEqual(['USD1'])
  })

  it('accepts a close that is seven days old and rejects one that is eight', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'])
    const trades = [buy('2025-01-06', 'AAA', '10', '10')]
    expect(run(trades, prices, 'MAX', '2025-01-13')).toMatchObject({ value: '100', unpriced: [] })
    expect(run(trades, prices, 'MAX', '2025-01-14')).toMatchObject({ value: '0', unpriced: ['AAA'] })
  })

  it('carries the prior close through an interior gap longer than seven days', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-19', '12'])
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], prices, 'MAX', '2025-01-19')
    expect(result).toMatchObject({ value: '120', change: '20', changePercent: '20', unpriced: [] })
    expect(result.series.slice(0, -1).map((point) => point.value)).toEqual(Array(13).fill('100'))
  })

  it('does not use a close after asOf to bridge a stale trailing gap', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-06', '10'], ['2025-01-19', '12'])
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], prices, 'MAX', '2025-01-18')
    expect(result).toMatchObject({ value: '0', unpriced: ['AAA'] })
  })

  it('does not backfill held days before the first available close', () => {
    const prices = closes('AAA', 'EUR', ['2025-01-19', '12'])
    const result = run([buy('2025-01-06', 'AAA', '10', '10')], prices, 'MAX', '2025-01-19')
    expect(result).toMatchObject({ value: '0', unpriced: ['AAA'] })
  })

  it('still rejects stale FX inside a bridged price history', () => {
    const prices = closes('USD1', 'USD', ['2025-01-06', '10'], ['2025-01-19', '12'])
    const rates = [{ date: '2025-01-06', eurPerUsd: '0.9' }, { date: '2025-01-19', eurPerUsd: '0.95' }]
    const result = run([buy('2025-01-06', 'USD1', '10', '10')], prices, 'MAX', '2025-01-19', rates)
    expect(result).toMatchObject({ value: '0', unpriced: ['USD1'] })
  })

  it('does not require a price before the first trade of the symbol', () => {
    const prices = [...closes('AAA', 'EUR', ['2025-01-06', '10']), ...closes('LATE', 'EUR', ['2025-01-07', '5'])]
    const result = run([buy('2025-01-06', 'AAA', '10', '10'), buy('2025-01-07', 'LATE', '2', '5')], prices, 'MAX', '2025-01-07')
    expect(result.unpriced).toEqual([])
  })
})
