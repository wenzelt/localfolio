import type { Sql } from 'postgres'
import { readLedger } from './ledger-store'
import { positionActivitiesOf } from './positions'
import { readCachedRates } from './fx-cache'
import { readCachedQuotes } from './quote-cache'
import { calculatePosition } from './ledger'

export async function readValuationReport(sql: Sql, asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) {
    throw new Error('Invalid valuation date')
  }
  const document = await readLedger(sql)
  const trades = positionActivitiesOf(document.activities)
  if (trades.some((trade) => trade.date.slice(0, 10) > asOf)) throw new Error('Valuation date precedes imported activity')
  const dates = [...new Set(trades.filter((trade) => trade.currency === 'USD').map((trade) => trade.date.slice(0, 10)))]
  const rates = await readCachedRates(sql, dates)
  const byDate = Object.fromEntries(rates.flatMap((rate) => rate.status === 'available' ? [[rate.date, rate.eurPerUsd]] : []))
  const quotes = await readCachedQuotes(sql, [...new Set(trades.map((trade) => trade.symbol))])
  return Promise.all(document.accounts.flatMap((account) => {
    const activities = trades.filter((trade) => trade.accountId === account.id)
    return [...new Set(activities.map((trade) => trade.symbol))].sort().map(async (symbol) => {
      const identity = { accountId: account.id, accountName: account.name, isExcluded: account.isExcluded, symbol }
      const trades = activities.filter((trade) => trade.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date))
      if (trades.some((trade) => trade.currency === 'USD' && byDate[trade.date.slice(0, 10)] === undefined)) {
        return { ...identity, status: 'historical-fx-required' as const }
      }
      const transactions = trades.map((trade) => ({ type: trade.type, quantity: trade.quantity, unitPrice: trade.unitPrice, fee: trade.fee, currency: trade.currency, eurPerUsd: byDate[trade.date.slice(0, 10)] }))
      const position = calculatePosition(transactions, 'EUR')
      if (position.quantity === '0') return { ...identity, ...position, status: 'valued' as const, marketValue: '0', unrealizedGain: '0' }
      const quote = quotes.find((quote) => quote.symbol === symbol)
      if (quote === undefined || quote.status === 'missing') return { ...identity, ...position, status: 'quote-required' as const }
      const age = (Date.parse(asOf) - Date.parse(quote.observedOn)) / 86400000
      if (age < 0) return { ...identity, ...position, quote, status: 'quote-future' as const }
      if (age > 7) return { ...identity, ...position, quote, status: 'quote-stale' as const }
      const [fx] = quote.currency === 'USD' ? await readCachedRates(sql, [quote.observedOn]) : []
      if (quote.currency === 'USD' && fx?.status !== 'available') return { ...identity, ...position, quote, status: 'current-fx-required' as const }
      const valuation = calculatePosition(transactions, 'EUR', { price: quote.price, currency: quote.currency, eurPerUsd: fx?.status === 'available' ? fx.eurPerUsd : undefined })
      return { ...identity, ...valuation, quote, ...(fx === undefined ? {} : { fx }), status: 'valued' as const }
    })
  }))
}
