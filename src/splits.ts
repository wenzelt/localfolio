import type { Sql, TransactionSql } from 'postgres'
import { decimalToFraction, divide, formatFraction, multiply } from './fraction'
import type { Fraction } from './fraction'

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
