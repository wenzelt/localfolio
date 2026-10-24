import type { Sql } from 'postgres'
import { add, decimalToFraction, divide, formatFraction, multiply, subtract } from './fraction'
import type { Fraction } from './fraction'
import { readRateHistory } from './fx-cache'
import { readLedger, tradesOf } from './ledger-store'
import { latest } from './performance'
import type { RateRow } from './performance'
import { readPriceHistory } from './price-history'
import type { HistoricalPrice } from './price-history'

export type DailyMovementItem = {
  accountId: string; accountName: string; symbol: string
  value: string | null; changePercent: string | null; observedOn: string | null; previousOn: string | null
}
type MovementTrade = { accountId: string; symbol: string; type: 'BUY' | 'SELL'; quantity: string; date: string }

const dayMilliseconds = 86_400_000
const maxGapDays = 7
const zero = decimalToFraction('0')
const hundred = decimalToFraction('100')

const gapInDays = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMilliseconds

// Newest bar vs the bar before it, in the quote currency. A missing, distant, zero or
// differently denominated reference gives null rather than a misleading 0.
export function dailyMovement(
  input: { accounts: { id: string; name: string }[]; trades: MovementTrade[]; prices: HistoricalPrice[]; rates: RateRow[] },
  asOf: string,
): DailyMovementItem[] {
  const rates = input.rates.map((rate) => ({ date: rate.date, eurPerUsd: decimalToFraction(rate.eurPerUsd) })).sort((a, b) => a.date.localeCompare(b.date))
  const barsBySymbol = new Map<string, (HistoricalPrice & { date: string })[]>()
  for (const price of input.prices) {
    if (price.observedOn > asOf) continue
    barsBySymbol.set(price.symbol, [...(barsBySymbol.get(price.symbol) ?? []), { ...price, date: price.observedOn }])
  }
  for (const bars of barsBySymbol.values()) bars.sort((a, b) => a.observedOn.localeCompare(b.observedOn))

  const held = new Map<string, Fraction>()
  for (const trade of input.trades) {
    if (trade.date.slice(0, 10) > asOf) continue
    const key = JSON.stringify([trade.accountId, trade.symbol])
    const quantity = decimalToFraction(trade.quantity)
    held.set(key, trade.type === 'BUY' ? add(held.get(key) ?? zero, quantity) : subtract(held.get(key) ?? zero, quantity))
  }

  return input.accounts.flatMap((account) => {
    const symbols = [...new Set(input.trades.filter((trade) => trade.accountId === account.id).map((trade) => trade.symbol))].sort()
    return symbols.flatMap((symbol): DailyMovementItem[] => {
      const quantity = held.get(JSON.stringify([account.id, symbol])) ?? zero
      if (quantity.numerator < 0n) throw new Error('Sold more than held')
      if (quantity.numerator === 0n) return []
      const identity = { accountId: account.id, accountName: account.name, symbol }
      const bars = barsBySymbol.get(symbol) ?? []
      const newest = latest(bars, asOf)
      if (newest === undefined) return [{ ...identity, value: null, changePercent: null, observedOn: null, previousOn: null }]
      const close = decimalToFraction(newest.close)
      const rate = newest.currency === 'EUR' ? decimalToFraction('1') : latest(rates, asOf)?.eurPerUsd
      const previous = bars[bars.indexOf(newest) - 1]
      const reference = previous && gapInDays(previous.observedOn, newest.observedOn) <= maxGapDays && previous.currency === newest.currency ? previous : undefined
      const base = reference && decimalToFraction(reference.close)
      return [{
        ...identity,
        value: rate === undefined ? null : formatFraction(multiply(multiply(quantity, close), rate)),
        changePercent: base === undefined || base.numerator === 0n ? null : formatFraction(multiply(divide(subtract(close, base), base), hundred)),
        observedOn: newest.observedOn,
        previousOn: reference?.observedOn ?? null,
      }]
    })
  })
}

export async function readDailyMovement(sql: Sql, asOf: string): Promise<DailyMovementItem[]> {
  const ledger = await readLedger(sql)
  const included = ledger.accounts.filter((account) => !account.isExcluded)
  const ids = new Set(included.map((account) => account.id))
  const trades = tradesOf(ledger.activities).filter((trade) => ids.has(trade.accountId))
  if (trades.length === 0) return []
  const prices = await readPriceHistory(sql, [...new Set(trades.map((trade) => trade.symbol))], asOf)
  const rates = await readRateHistory(sql, asOf)
  return dailyMovement({ accounts: included.map(({ id, name }) => ({ id, name })), trades, prices, rates }, asOf)
}
