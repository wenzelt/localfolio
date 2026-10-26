import type { Sql } from 'postgres'
import { ensureLedgerSchema } from './ledger-store'

export type AccountSummary = { id: string; name: string; currency: string; comment: string | null; transactions: number; positions: number }
export type AccountInput = { name: string; currency: string; comment?: string }

export class InvalidAccountError extends Error {}
// Lets the route tell a name that is taken (409) from input that is simply invalid (400).
export class DuplicateAccountError extends Error {}

const currencies = ['EUR', 'USD']

export async function listAccountSummaries(sql: Sql): Promise<AccountSummary[]> {
  // Reading must not create the ledger, so an empty database answers without touching the schema.
  const [{ name }] = await sql`SELECT to_regclass('accounts') AS name`
  if (name === null) return []
  const rows = await sql`
    SELECT a.id, a.name, a.currency, a.comment,
      (SELECT count(*) FROM transactions t WHERE t.account_id = a.id)::int AS transactions,
      (SELECT count(*) FROM (
        SELECT t.symbol FROM transactions t
        WHERE t.account_id = a.id AND t.type IN ('BUY', 'SELL') AND t.symbol IS NOT NULL
        GROUP BY t.symbol HAVING sum(CASE WHEN t.type = 'BUY' THEN t.quantity ELSE -t.quantity END) > 0
      ) open)::int AS positions
    FROM accounts a ORDER BY a.name, a.created_at`
  return rows.map((row) => ({ id: row.id, name: row.name, currency: row.currency, comment: row.comment, transactions: row.transactions, positions: row.positions }))
}

export async function addAccount(sql: Sql, input: AccountInput): Promise<{ id: string }> {
  const name = input.name.trim()
  if (name === '') throw new InvalidAccountError('Account name is required')
  if (!currencies.includes(input.currency)) throw new InvalidAccountError(`Unsupported currency: ${input.currency}`)
  const comment = input.comment?.trim() || null
  return sql.begin(async (tx) => {
    // The same lock CSV import takes before it creates accounts, so a name cannot be taken twice at once.
    await tx`SELECT pg_advisory_xact_lock(713821, 1)`
    await ensureLedgerSchema(tx)
    if ((await tx`SELECT 1 FROM accounts WHERE name = ${name}`).length > 0) throw new DuplicateAccountError(`An account named “${name}” already exists`)
    const [account] = await tx`INSERT INTO accounts (name, currency, comment) VALUES (${name}, ${input.currency}, ${comment}) RETURNING id`
    return { id: account.id as string }
  })
}

export type DeleteOutcome = { status: 'deleted'; transactions: number } | { status: 'mismatch' } | { status: 'not-found' }

// Removes the account with its whole history. Tags and balances go with it through their cascading keys.
export async function deleteAccount(sql: Sql, accountId: string, confirm: string): Promise<DeleteOutcome> {
  const [{ name }] = await sql`SELECT to_regclass('accounts') AS name`
  if (name === null) return { status: 'not-found' }
  return sql.begin(async (tx): Promise<DeleteOutcome> => {
    // Share the entry lock: a concurrent BUY cannot interleave with deleting its account.
    const accounts = await tx`SELECT name FROM accounts WHERE id = ${accountId} FOR UPDATE`
    if (accounts.length === 0) return { status: 'not-found' }
    if (accounts[0].name !== confirm) return { status: 'mismatch' }
    const removed = await tx`DELETE FROM transactions WHERE account_id = ${accountId} RETURNING id`
    await tx`DELETE FROM accounts WHERE id = ${accountId}`
    return { status: 'deleted', transactions: removed.length }
  })
}
