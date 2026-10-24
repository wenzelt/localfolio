import { add, decimalToFraction, formatFraction, multiply, subtract } from './fraction'
import type { Fraction } from './fraction'
import { performanceStart } from './performance-period'
import type { PerformancePeriod } from './performance-period'
import { performanceReturn } from './performance-return'
import type { Flow } from './performance-return'
import type { HistoricalPrice } from './price-history'

export type PerformanceActivity = {
  type: 'BUY' | 'SELL'; date: string; symbol: string
  quantity: string; unitPrice: string; fee: string; currency: 'EUR' | 'USD'
}
export type RateRow = { date: string; eurPerUsd: string }
type Close = { date: string; close: Fraction; currency: 'EUR' | 'USD' }

const maxAgeDays = 7
const dayMilliseconds = 86_400_000
const zero = decimalToFraction('0')
const one = decimalToFraction('1')

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMilliseconds).toISOString().slice(0, 10)
}

function ageInDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMilliseconds
}

// Carry forward interior price gaps only; trailing prices and FX retain the age limit.
export function latest<T extends { date: string }>(rows: T[], day: string, bridgeGaps = false): T | undefined {
  let low = 0
  let high = rows.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (rows[middle].date <= day) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found >= 0 && (ageInDays(rows[found].date, day) <= maxAgeDays || (bridgeGaps && found < rows.length - 1)) ? rows[found] : undefined
}

function priceSymbol(trades: PerformanceActivity[], closes: Close[], rates: { date: string; eurPerUsd: Fraction }[], asOf: string) {
  const rateOn = (currency: 'EUR' | 'USD', day: string) => currency === 'EUR' ? one : latest(rates, day)?.eurPerUsd
  const flows: Flow[] = []
  const deltas = new Map<string, Fraction>()
  let priced = true
  for (const trade of trades) {
    const day = trade.date.slice(0, 10)
    const quantity = decimalToFraction(trade.quantity)
    deltas.set(day, add(deltas.get(day) ?? zero, trade.type === 'BUY' ? quantity : subtract(zero, quantity)))
    const gross = multiply(quantity, decimalToFraction(trade.unitPrice))
    const fee = decimalToFraction(trade.fee)
    const rate = rateOn(trade.currency, day)
    if (rate === undefined) {
      priced = false
      continue
    }
    flows.push({ date: day, amount: formatFraction(multiply(trade.type === 'BUY' ? add(gross, fee) : subtract(fee, gross), rate)) })
  }
  const values = new Map<string, Fraction>()
  let quantity = zero
  for (let day = [...deltas.keys()].sort()[0]; day <= asOf; day = shift(day, 1)) {
    quantity = add(quantity, deltas.get(day) ?? zero)
    if (quantity.numerator < 0n) throw new Error('Sold more than held')
    if (quantity.numerator === 0n) continue
    const close = latest(closes, day, true)
    const rate = close && rateOn(close.currency, day)
    if (close === undefined || rate === undefined) {
      priced = false
      continue
    }
    values.set(day, multiply(multiply(quantity, close.close), rate))
  }
  return priced ? { flows, values } : null
}

export function calculatePerformance(
  input: { activities: PerformanceActivity[]; prices: HistoricalPrice[]; rates: RateRow[] },
  asOf: string,
  period: PerformancePeriod,
) {
  performanceStart(period, asOf, null)
  const rates = input.rates.map((rate) => ({ date: rate.date, eurPerUsd: decimalToFraction(rate.eurPerUsd) })).sort((a, b) => a.date.localeCompare(b.date))
  const activities = input.activities.filter((trade) => trade.date.slice(0, 10) <= asOf)
  const totals = new Map<string, Fraction>()
  const flows: Flow[] = []
  const unpriced: string[] = []
  for (const symbol of [...new Set(activities.map((trade) => trade.symbol))].sort()) {
    const closes = input.prices.filter((price) => price.symbol === symbol && price.observedOn <= asOf)
      .map((price) => ({ date: price.observedOn, close: decimalToFraction(price.close), currency: price.currency }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const result = priceSymbol(activities.filter((trade) => trade.symbol === symbol), closes, rates, asOf)
    if (result === null) {
      unpriced.push(symbol)
      continue
    }
    flows.push(...result.flows)
    for (const [day, value] of result.values) totals.set(day, add(totals.get(day) ?? zero, value))
  }
  const first = flows.map((flow) => flow.date).sort()[0] ?? null
  const from = performanceStart(period, asOf, first)
  if (from === null) return { period, from, to: asOf, value: '0', change: '0', changePercent: null as string | null, series: [], unpriced }
  const opening = formatFraction(totals.get(shift(from, -1)) ?? zero)
  const series = []
  let last = { change: '0', changePercent: null as string | null }
  let value = '0'
  for (let day = from; day <= asOf; day = shift(day, 1)) {
    value = formatFraction(totals.get(day) ?? zero)
    last = performanceReturn(opening, value, from, day, flows)
    series.push({ date: day, value, changePercent: last.changePercent })
  }
  return { period, from, to: asOf, value, change: last.change, changePercent: last.changePercent, series, unpriced }
}
