import { createHash } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import { parseGhostfolioJson } from './ghostfolio'

export type Counts = { accounts: number; balances: number; tags: number; activities: number }

export type LedgerAccount = {
  id: string; externalId: string | null; name: string; currency: 'EUR' | 'USD'; balance: string
  comment: string | null; isExcluded: boolean; balances: { date: string; value: string }[]
}
export type LedgerActivity = {
  id: string; accountId: string; type: 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE'
  symbol: string | null; dataSource: string | null; currency: 'EUR' | 'USD'
  quantity: string; unitPrice: string; fee: string; date: string; comment: string | null; tags: string[]
}

export type Trade = LedgerActivity & { type: 'BUY' | 'SELL'; symbol: string }

// Cash movements carry no instrument, so positions and valuations are built from buys and sells only.
export const tradesOf = (activities: LedgerActivity[]): Trade[] =>
  activities.filter((activity): activity is Trade => (activity.type === 'BUY' || activity.type === 'SELL') && activity.symbol !== null)

const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq bigint GENERATED ALWAYS AS IDENTITY,
    external_id text UNIQUE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    currency text NOT NULL CHECK (currency IN ('EUR', 'USD')),
    balance numeric NOT NULL DEFAULT 0,
    comment text,
    is_excluded boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS account_balances (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recorded_at timestamptz NOT NULL,
    value numeric NOT NULL,
    PRIMARY KEY (account_id, recorded_at)
  );
  CREATE TABLE IF NOT EXISTS tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE CHECK (btrim(name) <> '')
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq bigint GENERATED ALWAYS AS IDENTITY,
    external_key text UNIQUE,
    account_id uuid NOT NULL REFERENCES accounts(id),
    type text NOT NULL CHECK (type IN ('BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE')),
    symbol text,
    data_source text,
    currency text NOT NULL CHECK (currency IN ('EUR', 'USD')),
    quantity numeric NOT NULL CHECK (quantity > 0),
    unit_price numeric NOT NULL CHECK (unit_price >= 0),
    fee numeric NOT NULL CHECK (fee >= 0),
    occurred_at timestamptz NOT NULL,
    comment text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES tags(id),
    PRIMARY KEY (transaction_id, tag_id)
  )`

const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

export async function ensureLedgerSchema(sql: Sql | TransactionSql) {
  // Concurrent first-time creation would otherwise race inside the catalog.
  await sql`SELECT pg_advisory_xact_lock(hashtext('ledger-schema'))`
  await sql.unsafe(schema)
}

export async function importGhostfolioExport(sql: Sql, text: string): Promise<{ created: Counts; skipped: Counts }> {
  const document = parseGhostfolioJson(text)
  const created: Counts = { accounts: 0, balances: 0, tags: 0, activities: 0 }
  const skipped: Counts = { accounts: 0, balances: 0, tags: 0, activities: 0 }
  await sql.begin(async (tx) => {
    await ensureLedgerSchema(tx)
    const accountIds = new Map<string, string>()
    for (const account of document.accounts) {
      const [inserted] = await tx`INSERT INTO accounts (external_id, name, currency, balance, comment, is_excluded)
        VALUES (${account.id}, ${account.name}, ${account.currency}, ${String(account.balance)}, ${account.comment}, ${account.isExcluded})
        ON CONFLICT (external_id) DO NOTHING RETURNING id`
      if (inserted) created.accounts++
      else skipped.accounts++
      const [row] = inserted ? [inserted] : await tx`SELECT id FROM accounts WHERE external_id = ${account.id}`
      accountIds.set(account.id, row.id)
      for (const snapshot of account.balances) {
        const added = await tx`INSERT INTO account_balances (account_id, recorded_at, value)
          VALUES (${row.id}, ${snapshot.date}, ${String(snapshot.value)}) ON CONFLICT DO NOTHING RETURNING account_id`
        if (added.length) created.balances++
        else skipped.balances++
      }
    }
    const tagNames = new Map<string, string>()
    const tagIds = new Map<string, string>()
    for (const tag of document.tags) {
      tagNames.set(tag.id, tag.name)
      if (tagIds.has(tag.name)) continue
      const [inserted] = await tx`INSERT INTO tags (name) VALUES (${tag.name}) ON CONFLICT (name) DO NOTHING RETURNING id`
      if (inserted) created.tags++
      else skipped.tags++
      const [row] = inserted ? [inserted] : await tx`SELECT id FROM tags WHERE name = ${tag.name}`
      tagIds.set(tag.name, row.id)
    }
    const occurrences = new Map<string, number>()
    for (const activity of document.activities) {
      const base = createHash('sha256').update(JSON.stringify([activity.accountId, activity.type, activity.symbol,
        activity.dataSource, activity.currency, activity.quantity, activity.unitPrice, activity.fee, activity.date,
        activity.comment, [...activity.tags].sort()])).digest('hex')
      const ordinal = occurrences.get(base) ?? 0
      occurrences.set(base, ordinal + 1)
      const [inserted] = await tx`INSERT INTO transactions (external_key, account_id, type, symbol, data_source, currency,
          quantity, unit_price, fee, occurred_at, comment)
        VALUES (${`${base}:${ordinal}`}, ${accountIds.get(activity.accountId)!}, ${activity.type}, ${activity.symbol},
          ${activity.dataSource}, ${activity.currency}, ${String(activity.quantity)}, ${String(activity.unitPrice)},
          ${String(activity.fee)}, ${activity.date}, ${activity.comment})
        ON CONFLICT (external_key) DO NOTHING RETURNING id`
      if (!inserted) {
        skipped.activities++
        continue
      }
      created.activities++
      for (const tag of activity.tags) {
        await tx`INSERT INTO transaction_tags (transaction_id, tag_id)
          VALUES (${inserted.id}, ${tagIds.get(tagNames.get(tag)!)!}) ON CONFLICT DO NOTHING`
      }
    }
  })
  return { created, skipped }
}

export async function readLedger(sql: Sql): Promise<{ accounts: LedgerAccount[]; activities: LedgerActivity[] }> {
  const [table] = await sql`SELECT to_regclass('accounts') AS name`
  if (table.name === null) return { accounts: [], activities: [] }
  const balances = await sql<{ accountId: string; date: string; value: string }[]>`
    SELECT account_id AS "accountId", ${sql.unsafe(isoUtc('recorded_at'))} AS date, value::text AS value
    FROM account_balances ORDER BY recorded_at`
  const accounts = await sql<Omit<LedgerAccount, 'balances'>[]>`
    SELECT id, external_id AS "externalId", name, currency, balance::text AS balance, comment, is_excluded AS "isExcluded"
    FROM accounts ORDER BY seq`
  const activities = await sql<LedgerActivity[]>`
    SELECT t.id, t.account_id AS "accountId", t.type, t.symbol, t.data_source AS "dataSource", t.currency,
      t.quantity::text AS quantity, t.unit_price::text AS "unitPrice", t.fee::text AS fee,
      ${sql.unsafe(isoUtc('t.occurred_at'))} AS date, t.comment,
      coalesce((SELECT array_agg(g.name ORDER BY g.name) FROM transaction_tags x JOIN tags g ON g.id = x.tag_id
        WHERE x.transaction_id = t.id), '{}') AS tags
    FROM transactions t ORDER BY t.occurred_at, t.seq`
  return {
    accounts: accounts.map((account) => ({
      ...account,
      balances: balances.filter((snapshot) => snapshot.accountId === account.id).map(({ date, value }) => ({ date, value })),
    })),
    activities: [...activities],
  }
}
