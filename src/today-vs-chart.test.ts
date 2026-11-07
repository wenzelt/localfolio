import { describe, expect, it } from 'vitest'
import { withCash } from './cash'
import { dailyMovement } from './daily-movement'
import { dailySummary } from './daily-summary'
import { calculatePerformance } from './performance'

// Week to date, Monday 2026-11-02 to Friday 2026-11-06, one EUR ETF and one USD stock bought the week before.
const activities = [
  { type: 'BUY' as const, date: '2026-10-26', symbol: 'ETF', quantity: '100', unitPrice: '400', fee: '0', currency: 'EUR' as const },
  { type: 'BUY' as const, date: '2026-10-26', symbol: 'US', quantity: '50', unitPrice: '300', fee: '0', currency: 'USD' as const },
]
const prices = [
  { symbol: 'ETF', observedOn: '2026-10-26', close: '401', currency: 'EUR' as const },
  { symbol: 'ETF', observedOn: '2026-11-05', close: '400', currency: 'EUR' as const },
  { symbol: 'ETF', observedOn: '2026-11-06', close: '398', currency: 'EUR' as const },
  { symbol: 'US', observedOn: '2026-10-26', close: '299', currency: 'USD' as const },
  { symbol: 'US', observedOn: '2026-11-05', close: '300', currency: 'USD' as const },
  { symbol: 'US', observedOn: '2026-11-06', close: '302', currency: 'USD' as const },
]

function todayAndChart(rates: { date: string; eurPerUsd: string }[]) {
  const asOf = '2026-11-06'
  const chart = calculatePerformance({ activities, prices, rates }, asOf, 'WTD').series
  const [previous, latest] = chart.slice(-2)
  const trades = activities.map(({ type, date, symbol, quantity }) => ({ accountId: 'a', type, date, symbol, quantity }))
  const today = dailySummary(withCash(dailyMovement({ accounts: [{ id: 'a', name: 'Broker' }], trades, prices, rates }, asOf)))
  return { chartChange: Number(latest.value) - Number(previous.value), today: Number(today.change) }
}

describe('Today against the chart', () => {
  it('agrees when the exchange rate is flat', () => {
    const { chartChange, today } = todayAndChart([{ date: '2026-10-26', eurPerUsd: '0.86' }, { date: '2026-11-02', eurPerUsd: '0.86' }])
    expect(today).toBeCloseTo(chartChange, 9)
  })

  // The ETF loses EUR 200 and the stock gains USD 100. The dollar strengthens from 0.86 to 0.87 EUR,
  // which lifts yesterday's USD 15,000 by EUR 150. The chart moves +37; Today showed -113.
  it('matches the change between the last two chart points when the dollar moves', () => {
    const { chartChange, today } = todayAndChart([{ date: '2026-10-26', eurPerUsd: '0.86' }, { date: '2026-11-02', eurPerUsd: '0.86' }, { date: '2026-11-05', eurPerUsd: '0.86' }, { date: '2026-11-06', eurPerUsd: '0.87' }])
    expect(chartChange).toBeCloseTo(37, 9)
    expect(today).toBeCloseTo(chartChange, 9)
  })
})
