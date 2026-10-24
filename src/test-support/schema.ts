import postgres from 'postgres'
import type { Sql } from 'postgres'

export async function withIsolatedDatabase<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const { sql, drop } = await isolatedDatabase()
  try {
    return await run(sql)
  } finally {
    await drop()
  }
}

export const cacheTables = `
  CREATE TABLE security_prices (symbol text, observed_on date, close numeric, currency text, source text, fetched_at timestamptz);
  CREATE TABLE security_quotes (symbol text, observed_on date, price numeric, currency text, source text, fetched_at timestamptz);
  CREATE TABLE fx_observations (observed_on date, eur_per_usd numeric, source text)`

// Each test gets its own Postgres schema, so tests that share table names cannot see each other's rows.
export async function isolatedDatabase(): Promise<{ sql: Sql; url: string; drop: () => Promise<void> }> {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = '/portfolio_test'
  const schema = `t_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = postgres(url.toString())
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  // No public fallback: tables left there by older runs must stay invisible to the test.
  url.searchParams.set('search_path', schema)
  const sql = postgres(url.toString())
  return {
    sql,
    url: url.toString(),
    drop: async () => {
      await sql.end()
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`)
      await admin.end()
    },
  }
}
