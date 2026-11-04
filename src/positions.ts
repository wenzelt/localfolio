import type { Sql } from 'postgres'
import { add, decimalToFraction, divide, formatFraction, signedDecimalToFraction } from './fraction'
import type { Fraction } from './fraction'
import { calculatePosition } from './ledger'
import { chronological, readLedger } from './ledger-store'
import type { LedgerAccount, LedgerActivity } from './ledger-store'
import { latest } from './performance'
import type { RateRow } from './performance'

type PositionActivity = LedgerActivity & { type: 'BUY' | 'SELL' | 'DIVIDEND'; symbol: string }

// A dividend on a symbol belongs to that position as realised income; other cash movements carry no instrument.
export const positionActivitiesOf = (activities: LedgerActivity[]): PositionActivity[] =>
  activities.filter((activity): activity is PositionActivity =>
    (activity.type === 'BUY' || activity.type === 'SELL' || activity.type === 'DIVIDEND') && activity.symbol !== null)

// The position report converts every USD trade and dividend, so each of their dates needs a rate.
export const usdRateDatesOf = (activities: LedgerActivity[]) => [...new Set(positionActivitiesOf(activities)
  .filter((activity) => activity.currency === 'USD')
  .map((activity) => activity.date.slice(0, 10)))]

export function positionReport(
  ledger: { accounts: LedgerAccount[]; activities: LedgerActivity[] },
  eurPerUsdByDate?: Record<string, string>,
) {
  const allTrades = positionActivitiesOf(ledger.activities)
  return ledger.accounts.flatMap((account) => {
    const activities = allTrades.filter((activity) => activity.accountId === account.id)
    const symbols = [...new Set(activities.map((activity) => activity.symbol))].sort()
    return symbols.map((symbol) => {
      const trades = activities.filter((activity) => activity.symbol === symbol).sort(chronological)
      const identity = { accountId: account.id, accountName: account.name,
        isExcluded: account.isExcluded, symbol }
      const needsFx = eurPerUsdByDate === undefined
        ? new Set(trades.map((trade) => trade.currency)).size > 1
        : trades.some((trade) => trade.currency === 'USD' && eurPerUsdByDate[trade.date.slice(0, 10)] === undefined)
      if (needsFx) {
        return { ...identity, status: 'historical-fx-required' as const }
      }
      const position = calculatePosition(trades.map((trade) => ({
        type: trade.type, currency: trade.currency, quantity: trade.quantity,
        unitPrice: trade.unitPrice, fee: trade.fee,
        eurPerUsd: eurPerUsdByDate?.[trade.date.slice(0, 10)],
      })), eurPerUsdByDate === undefined ? undefined : 'EUR')
      // A holding bought only in USD keeps its USD cost basis next to the EUR one.
      const nativeInvested: { nativeInvested?: string } = eurPerUsdByDate !== undefined && trades.every((trade) => trade.currency === 'USD')
        ? { nativeInvested: calculatePosition(trades.map((trade) => ({
          type: trade.type, currency: trade.currency, quantity: trade.quantity,
          unitPrice: trade.unitPrice, fee: trade.fee }))).invested }
        : {}
      return { ...identity, status: 'calculated' as const, ...position, ...nativeInvested }
    })
  })
}

// With a rate history, every USD trade is converted at the latest rate on or before its day, at most seven days old,
// the same rule the chart and the valuation report use. Without one, positions stay in their trade currency.
export async function readPositionReport(sql: Sql, rates?: RateRow[]) {
  const ledger = await readLedger(sql)
  if (rates === undefined) return positionReport(ledger)
  const byDate: Record<string, string> = Object.create(null)
  for (const date of usdRateDatesOf(ledger.activities)) {
    const rate = latest(rates, date)
    if (rate !== undefined) byDate[date] = rate.eurPerUsd
  }
  return positionReport(ledger, byDate)
}

const zero = decimalToFraction('0')

// One position per symbol across accounts, so it does not matter which account holds it.
// Excluded accounts are left out, as everywhere on the dashboard. Accounts that sold out are not named, but their realised gains count.
export function combinePositions(positions: ReturnType<typeof positionReport>) {
  const included = positions.filter((position) => !position.isExcluded)
  return [...new Set(included.map((position) => position.symbol))].sort().map((symbol) => {
    const parts = included.filter((position) => position.symbol === symbol)
    const calculated = parts.flatMap((part) => part.status === 'calculated' ? [part] : [])
    const accounts = parts.filter((part) => part.status !== 'calculated' || signedDecimalToFraction(part.quantity).numerator > 0n)
      .map((part) => ({ id: part.accountId, name: part.accountName }))
    // A partial sum would mislead: with any account unpriced, or in another currency, there is no combined figure.
    if (calculated.length < parts.length || new Set(calculated.map((part) => part.currency)).size > 1) {
      return { symbol, accounts, status: 'historical-fx-required' as const }
    }
    const total = (field: 'quantity' | 'invested' | 'realizedGain') => calculated.reduce((sum, part) => add(sum, signedDecimalToFraction(part[field])), zero)
    const quantity = total('quantity')
    const invested = total('invested')
    const natives = calculated.map((part) => part.nativeInvested)
    const nativeInvested = natives.every((native) => native !== undefined)
      ? { nativeInvested: formatFraction(natives.reduce<Fraction>((sum, native) => add(sum, signedDecimalToFraction(native ?? '0')), zero)) } : {}
    return {
      symbol, accounts, status: 'calculated' as const, currency: calculated[0].currency,
      quantity: formatFraction(quantity), averageCost: quantity.numerator > 0n ? formatFraction(divide(invested, quantity)) : '0',
      invested: formatFraction(invested), realizedGain: formatFraction(total('realizedGain')), ...nativeInvested,
    }
  })
}
