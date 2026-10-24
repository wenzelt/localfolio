import type { Sql } from 'postgres'
import type { CountryComposition } from './country-exposure'

export async function readCountryCompositions(sql: Sql): Promise<Record<string, CountryComposition>> {
  const [table] = await sql`SELECT to_regclass('security_countries') AS name`
  if (!table.name) return {}
  const rows = await sql`SELECT symbol, weights, source, as_of::text, fetched_at FROM security_countries`
  return Object.fromEntries(rows.map((row) => [row.symbol, { weights: row.weights, source: row.source, asOf: row.as_of, fetchedAt: row.fetched_at?.toISOString() ?? null }]))
}
