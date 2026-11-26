import type { Sql, TransactionSql } from 'postgres'
import { decimalToFraction, divide, formatFraction, multiply } from './fraction'
import type { Fraction } from './fraction'
import { readPriceHistory } from './price-history'
import type { HistoricalPrice } from './price-history'

// Ratio is new shares per old share: 60 for a 1:60 split, 0.1 for a 10:1 reverse split.
export type Split = { symbol: string; effectiveOn: string; ratio: string }

export async function readSplits(sql: Sql | TransactionSql, symbols: string[]): Promise<Split[]> {
  if (symbols.length === 0) return []
  const [table] = await sql`SELECT to_regclass('security_splits') AS name`
  if (table.name === null) return []
  return sql<Split[]>`
    SELECT symbol, effective_on::text AS "effectiveOn", ratio::text AS ratio
    FROM security_splits WHERE symbol IN ${sql(symbols)} ORDER BY symbol, effective_on
  `
}

// Stored closes are split-adjusted, so a trade made before a split is restated in today's shares.
// Quantity grows by the ratio and the unit price shrinks by it, which leaves what was paid unchanged.
// A trade on the effective day was already made at the new price and stays as it is.
export function adjustForSplits<T extends { type: string; symbol: string | null; date: string; quantity: string; unitPrice: string }>(activities: T[], splits: Split[]): T[] {
  if (splits.length === 0) return activities
  const bySymbol = new Map<string, { effectiveOn: string; ratio: Fraction }[]>()
  for (const split of splits) bySymbol.set(split.symbol, [...(bySymbol.get(split.symbol) ?? []), { effectiveOn: split.effectiveOn, ratio: decimalToFraction(split.ratio) }])
  return activities.map((activity) => {
    if (activity.symbol === null || (activity.type !== 'BUY' && activity.type !== 'SELL')) return activity
    const day = activity.date.slice(0, 10)
    const later = (bySymbol.get(activity.symbol) ?? []).filter((split) => split.effectiveOn > day)
    if (later.length === 0) return activity
    const ratio = later.reduce((product, split) => multiply(product, split.ratio), decimalToFraction('1'))
    return {
      ...activity,
      quantity: formatFraction(multiply(decimalToFraction(activity.quantity), ratio)),
      unitPrice: formatFraction(divide(decimalToFraction(activity.unitPrice), ratio)),
    }
  })
}

// Providers differ: some restate every past close after a split, some leave the old ones at the old price.
// The stored closes are checked rather than assumed. If the last close before a split sits about one ratio above (or
// below) the first close after it, the closes before the split are on the old scale and are divided by the ratio.
// If the two are close, they were adjusted already. Splits are handled newest first, so an earlier one compares
// against closes that are already on the new scale.
export function adjustCloses<T extends Pick<HistoricalPrice, 'symbol' | 'observedOn' | 'close'>>(prices: T[], splits: Split[]): T[] {
  if (splits.length === 0) return prices
  const scaled = new Map<T, string>()
  const value = (price: T) => scaled.get(price) ?? price.close
  for (const symbol of new Set(splits.map((split) => split.symbol))) {
    const bars = prices.filter((price) => price.symbol === symbol).sort((a, b) => a.observedOn.localeCompare(b.observedOn))
    const own = splits.filter((split) => split.symbol === symbol).sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn))
    for (const { effectiveOn, ratio } of own) {
      const before = bars.filter((bar) => bar.observedOn < effectiveOn)
      const after = bars.find((bar) => bar.observedOn >= effectiveOn)
      const previous = before.at(-1)
      if (previous === undefined || after === undefined) continue
      const jump = Math.log(Number(value(previous)) / Number(value(after)))
      const target = Math.log(Number(ratio))
      if (!Number.isFinite(jump) || target === 0 || Math.abs(jump - target) >= Math.abs(jump)) continue
      for (const bar of before) scaled.set(bar, formatFraction(divide(decimalToFraction(value(bar)), decimalToFraction(ratio))))
    }
  }
  return prices.map((price) => scaled.has(price) ? { ...price, close: scaled.get(price) as string } : price)
}

export async function readAdjustedPriceHistory(sql: Sql | TransactionSql, symbols: string[], asOf: string): Promise<HistoricalPrice[]> {
  return adjustCloses(await readPriceHistory(sql, symbols, asOf), await readSplits(sql, symbols))
}
