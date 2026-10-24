import type { Sql } from 'postgres'
import { calculatePosition } from './ledger'
import { readLedger } from './ledger-store'
import type { LedgerAccount, LedgerActivity } from './ledger-store'

type PositionActivity = LedgerActivity & { type: 'BUY' | 'SELL' | 'DIVIDEND'; symbol: string }

// A dividend on a symbol belongs to that position as realised income; other cash movements carry no instrument.
export const positionActivitiesOf = (activities: LedgerActivity[]): PositionActivity[] =>
  activities.filter((activity): activity is PositionActivity =>
    (activity.type === 'BUY' || activity.type === 'SELL' || activity.type === 'DIVIDEND') && activity.symbol !== null)

export function positionReport(
  ledger: { accounts: LedgerAccount[]; activities: LedgerActivity[] },
  eurPerUsdByDate?: Record<string, string>,
) {
  const allTrades = positionActivitiesOf(ledger.activities)
  return ledger.accounts.flatMap((account) => {
    const activities = allTrades.filter((activity) => activity.accountId === account.id)
    const symbols = [...new Set(activities.map((activity) => activity.symbol))].sort()
    return symbols.map((symbol) => {
      const trades = activities.filter((activity) => activity.symbol === symbol)
        .sort((left, right) => left.date.localeCompare(right.date))
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

export async function readPositionReport(sql: Sql, eurPerUsdByDate?: Record<string, string>) {
  return positionReport(await readLedger(sql), eurPerUsdByDate)
}
