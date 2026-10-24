import type { Sql, TransactionSql } from 'postgres'
import { readLedger } from './ledger-store'
import type { LedgerActivity } from './ledger-store'
import { positionActivitiesOf, positionReport } from './positions'

type CachedRate = {
  date: string
  status: 'available'
  observedOn: string
  eurPerUsd: string
  source: string
} | { date: string; status: 'missing' }

export async function readCachedRates(sql: Sql, dates: string[]): Promise<CachedRate[]> {
  if (dates.length === 0) return []
  const [table] = await sql`SELECT to_regclass('fx_observations') AS name`
  if (!table.name) return dates.map((date) => ({ date, status: 'missing' }))

  return Promise.all(dates.map(async (date): Promise<CachedRate> => {
    const [rate] = await sql`
      SELECT observed_on::text AS "observedOn", eur_per_usd::text AS "eurPerUsd", source
      FROM fx_observations
      WHERE observed_on <= ${date}::date AND observed_on >= ${date}::date - 7
      ORDER BY observed_on DESC LIMIT 1
    `
    return rate
      ? { date, status: 'available', observedOn: rate.observedOn, eurPerUsd: rate.eurPerUsd, source: rate.source }
      : { date, status: 'missing' }
  }))
}

export async function readRateHistory(sql: Sql | TransactionSql, asOf: string): Promise<{ date: string; eurPerUsd: string }[]> {
  const [table] = await sql`SELECT to_regclass('fx_observations') AS name`
  if (!table.name) return []
  return sql<{ date: string; eurPerUsd: string }[]>`
    SELECT observed_on::text AS date, eur_per_usd::text AS "eurPerUsd"
    FROM fx_observations WHERE observed_on <= ${asOf}::date ORDER BY observed_on
  `
}

// The position report converts every USD trade and dividend, so each of their dates needs a rate.
export const usdRateDatesOf = (activities: LedgerActivity[]) => [...new Set(positionActivitiesOf(activities)
  .filter((activity) => activity.currency === 'USD')
  .map((activity) => activity.date.slice(0, 10)))]

export async function readCachedPositionReport(sql: Sql) {
  const ledger = await readLedger(sql)
  const dates = usdRateDatesOf(ledger.activities)
  const rates = await readCachedRates(sql, dates)
  const byDate: Record<string, string> = Object.create(null)
  for (const rate of rates) {
    if (rate.status === 'available') byDate[rate.date] = rate.eurPerUsd
  }
  return positionReport(ledger, byDate)
}
