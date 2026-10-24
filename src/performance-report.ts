import type { Sql } from 'postgres'
import { readRateHistory } from './fx-cache'
import { dataFreshness } from './freshness'
import { readLedger, tradesOf } from './ledger-store'
import { calculatePerformance, latest } from './performance'
import { performanceStart } from './performance-period'
import type { PerformancePeriod } from './performance-period'
import { readPriceHistory, readPricesFetchedAt } from './price-history'

export async function readPerformanceReport(sql: Sql, asOf: string, period: PerformancePeriod, scope?: { accountId: string; symbol: string }) {
  performanceStart(period, asOf, null)
  const ledger = await readLedger(sql)
  if (ledger.accounts.length === 0) return null
  const included = new Set(ledger.accounts.filter((account) => !account.isExcluded).map((account) => account.id))
  const activities = tradesOf(ledger.activities).filter((trade) => included.has(trade.accountId) && (!scope || (trade.accountId === scope.accountId && trade.symbol === scope.symbol))).map((trade) => ({
    type: trade.type, date: trade.date, symbol: trade.symbol, currency: trade.currency,
    quantity: trade.quantity, unitPrice: trade.unitPrice, fee: trade.fee,
  }))
  if (scope && activities.length === 0) return null
  const symbols = [...new Set(activities.map((trade) => trade.symbol))]
  const prices = await readPriceHistory(sql, symbols, asOf)
  const rates = await readRateHistory(sql, asOf)
  const needsFx = activities.some((trade) => trade.currency === 'USD')
  const performance = calculatePerformance({ activities, prices, rates }, asOf, period)
  const freshness = { ...dataFreshness({ prices, rates, needsFx, asOf }), fetchedAt: await readPricesFetchedAt(sql, symbols) }
  if (!scope) return { ...performance, freshness }
  // One symbol: expose the close behind each day's value, with the date it was observed.
  const closes = prices.filter((price) => price.symbol === scope.symbol)
    .map((price) => ({ date: price.observedOn, close: price.close, currency: price.currency }))
  const series = performance.series.map((day) => ({ ...day, price: latest(closes, day.date, true) ?? null }))
  return { ...performance, series, freshness }
}
