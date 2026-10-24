import postgres from 'postgres'
import { addTransaction, createAccount } from '../src/ledger-entry'
import { cacheTables } from '../src/test-support/schema'
import { e2e, testDatabaseUrl } from './env'

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

// EUR and USD holdings, a fully sold position, and a position in an excluded account.
const closes = { EUETF: 100, USSTOCK: 200, CLOSED: 50, HIDDEN: 80 }

export default async function seed() {
  const admin = postgres(testDatabaseUrl(false))
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${e2e.schema} CASCADE; CREATE SCHEMA ${e2e.schema}`)
  const sql = postgres(testDatabaseUrl(true))

  const main = await createAccount(sql, { name: 'Main broker', currency: 'EUR' })
  const excluded = await createAccount(sql, { name: 'Excluded broker', currency: 'EUR' })
  await sql`UPDATE accounts SET is_excluded = true WHERE id = ${excluded.id}`
  const buy = (accountId: string, symbol: string, currency: string, date: string, quantity: string, unitPrice: string) =>
    addTransaction(sql, { accountId, type: 'BUY', date, currency, symbol, quantity, unitPrice })
  await buy(main.id, 'EUETF', 'EUR', day(-300), '12.5', '100')
  await buy(main.id, 'USSTOCK', 'USD', day(-250), '5', '200')
  await buy(main.id, 'CLOSED', 'EUR', day(-280), '3', '50')
  await addTransaction(sql, { accountId: main.id, type: 'SELL', date: day(-200), currency: 'EUR', symbol: 'CLOSED', quantity: '3', unitPrice: '55' })
  await buy(excluded.id, 'HIDDEN', 'EUR', day(-250), '4', '80')

  await sql.unsafe(cacheTables)
  await sql.unsafe('CREATE TABLE security_names (symbol text, name text)')
  await sql`INSERT INTO security_names VALUES ('EUETF', 'Synthetic EU ETF'), ('USSTOCK', 'Synthetic US Stock'), ('CLOSED', 'Synthetic Closed Fund'), ('HIDDEN', 'Synthetic Excluded Fund')`
  const prices = []
  const rates = []
  for (let offset = -320; offset <= 0; offset++) {
    // A slow wave around each base close so the chart has a shape and every day moves.
    const wave = 1 + 0.08 * Math.sin(offset / 20) + offset / 4000
    for (const [symbol, base] of Object.entries(closes)) {
      prices.push({ symbol, observed_on: day(offset), close: (base * wave).toFixed(4), currency: symbol === 'USSTOCK' ? 'USD' : 'EUR', source: 'e2e', fetched_at: new Date() })
    }
    rates.push({ observed_on: day(offset), eur_per_usd: (0.9 + 0.02 * Math.sin(offset / 30)).toFixed(6), source: 'e2e' })
  }
  await sql`INSERT INTO security_prices ${sql(prices)}`
  await sql`INSERT INTO fx_observations ${sql(rates)}`
  await sql.unsafe('CREATE TABLE security_countries (symbol text PRIMARY KEY, weights jsonb, source text, as_of date, fetched_at timestamptz)')
  await sql`INSERT INTO security_countries VALUES
    ('EUETF', '{"Germany":"25","United States of America":"50"}'::jsonb, 'https://example.org/synthetic-fund', ${day(-120)}, ${new Date()}),
    ('USSTOCK', '{"United States":"100"}'::jsonb, 'https://example.org/synthetic-stock', ${day(-1)}, ${new Date()})`
  await sql.end()

  return async () => {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${e2e.schema} CASCADE`)
    await admin.end()
  }
}
