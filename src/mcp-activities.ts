import type { Sql } from 'postgres'
import type { LedgerActivity } from './ledger-store'

export type ActivityFilter = { accountId?: string; type?: string; from?: string; to?: string; limit: number; offset: number }

export async function readMcpActivities(sql: Sql, filter: ActivityFilter) {
  const [table] = await sql`SELECT to_regclass('transactions') AS name`
  if (table.name === null) return { activities: [], nextOffset: null }
  const rows = await sql<LedgerActivity[]>`
    SELECT t.id, t.account_id AS "accountId", t.type, t.symbol, t.data_source AS "dataSource", t.currency,
      t.quantity::text AS quantity, t.unit_price::text AS "unitPrice", t.fee::text AS fee,
      to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date, t.comment,
      coalesce((SELECT array_agg(g.name ORDER BY g.name) FROM transaction_tags x JOIN tags g ON g.id = x.tag_id
        WHERE x.transaction_id = t.id), '{}') AS tags
    FROM transactions t
    WHERE true
      ${filter.accountId ? sql`AND t.account_id = ${filter.accountId}` : sql``}
      ${filter.type ? sql`AND t.type = ${filter.type}` : sql``}
      ${filter.from ? sql`AND t.occurred_at >= ${filter.from}::date::timestamp AT TIME ZONE 'UTC'` : sql``}
      ${filter.to ? sql`AND t.occurred_at < (${filter.to}::date + 1)::timestamp AT TIME ZONE 'UTC'` : sql``}
    ORDER BY t.occurred_at, t.seq
    LIMIT ${filter.limit + 1} OFFSET ${filter.offset}`
  return { activities: rows.slice(0, filter.limit), nextOffset: rows.length > filter.limit ? filter.offset + filter.limit : null }
}
