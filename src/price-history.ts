import type { Sql, TransactionSql } from 'postgres'

export type HistoricalPrice = {
  symbol: string
  observedOn: string
  close: string
  currency: 'EUR' | 'USD'
}

export async function readPriceHistory(sql: Sql | TransactionSql, symbols: string[], asOf: string): Promise<HistoricalPrice[]> {
  if (symbols.length === 0) return []
  const [table] = await sql`SELECT to_regclass('security_prices') AS name`
  if (table.name === null) return []
  return sql<HistoricalPrice[]>`
    SELECT symbol, observed_on::text AS "observedOn", close::text AS close, currency
    FROM security_prices
    WHERE symbol IN ${sql(symbols)} AND observed_on <= ${asOf}::date
    ORDER BY symbol, observed_on
  `
}

// When the worker last wrote a price for these symbols, so the dashboard can show how live its data is.
export async function readPricesFetchedAt(sql: Sql | TransactionSql, symbols: string[]): Promise<string | null> {
  if (symbols.length === 0) return null
  const [table] = await sql`SELECT to_regclass('security_prices') AS name`
  if (table.name === null) return null
  const [row] = await sql<{ fetchedAt: Date | null }[]>`SELECT max(fetched_at) AS "fetchedAt" FROM security_prices WHERE symbol IN ${sql(symbols)}`
  return row.fetchedAt?.toISOString() ?? null
}
