import type { Sql, TransactionSql } from 'postgres'

type CachedQuote = {
  symbol: string
  status: 'available'
  observedOn: string
  price: string
  currency: 'EUR' | 'USD'
  source: string
  fetchedAt: string
} | { symbol: string; status: 'missing' }

export async function readCachedQuotes(sql: Sql | TransactionSql, symbols: string[]): Promise<CachedQuote[]> {
  if (symbols.length === 0) return []
  const [table] = await sql`SELECT to_regclass('security_quotes') AS name`
  if (table.name === null) return symbols.map((symbol) => ({ symbol, status: 'missing' }))
  return Promise.all(symbols.map(async (symbol): Promise<CachedQuote> => {
    const [quote] = await sql`
      SELECT observed_on::text AS "observedOn", price::text AS price,
             currency, source, fetched_at::text AS "fetchedAt"
      FROM security_quotes WHERE symbol = ${symbol}
    `
    return quote === undefined
      ? { symbol, status: 'missing' }
      : { symbol, status: 'available', observedOn: quote.observedOn, price: quote.price,
          currency: quote.currency, source: quote.source, fetchedAt: quote.fetchedAt }
  }))
}
