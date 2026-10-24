import type { Sql } from 'postgres'
import { ensureLedgerSchema } from './ledger-store'

const types = ['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE']
const currencies = ['EUR', 'USD']
const cashTypes = ['DEPOSIT', 'WITHDRAWAL', 'FEE', 'DIVIDEND']

// Lets callers tell a probable double entry, which a person may confirm, from an entry that is simply invalid.
export class DuplicateTransactionError extends Error {}

export type AccountInput = { name: string; currency: string; comment?: string }
export type TransactionInput = {
  accountId: string; type: string; date: string; currency: string; symbol?: string
  quantity?: string; unitPrice?: string; fee?: string; amount?: string; comment?: string; force?: boolean
}

// Decimals stay strings end to end so fractional amounts never pass through a float.
const isDecimal = (value: string | undefined): value is string => value !== undefined && /^\d+(\.\d+)?$/.test(value)
const isPositive = (value: string | undefined): value is string => isDecimal(value) && /[1-9]/.test(value)

const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/
const dateTime = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/

function utcDate(text: string) {
  const match = dateOnly.exec(text) ?? dateTime.exec(text)
  if (!match) throw new Error(`Invalid date: ${text}`)
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error(`Invalid date: ${text}`)
  return new Date(Date.parse(dateOnly.test(text) ? `${text}T00:00:00.000Z` : text)).toISOString()
}

export async function createAccount(sql: Sql, input: AccountInput): Promise<{ id: string }> {
  const name = input.name.trim()
  if (name === '') throw new Error('Account name is required')
  if (!currencies.includes(input.currency)) throw new Error(`Unsupported currency: ${input.currency}`)
  return sql.begin(async (tx) => {
    await ensureLedgerSchema(tx)
    const [account] = await tx`INSERT INTO accounts (name, currency, comment)
      VALUES (${name}, ${input.currency}, ${input.comment ?? null}) RETURNING id`
    return { id: account.id as string }
  })
}

function validate(input: TransactionInput) {
  if (!types.includes(input.type)) throw new Error(`Unsupported type: ${input.type}`)
  if (!currencies.includes(input.currency)) throw new Error(`Unsupported currency: ${input.currency}`)
  const occurredAt = utcDate(input.date)
  const symbol = input.symbol === undefined ? null : input.symbol.trim()
  if (cashTypes.includes(input.type)) {
    if (input.quantity !== undefined || input.unitPrice !== undefined) throw new Error('Quantity and unit price are only for trades')
    if (!isPositive(input.amount)) throw new Error(`Invalid amount: ${input.amount}`)
    if (input.type !== 'DIVIDEND' && symbol !== null) throw new Error(`A ${input.type.toLowerCase()} has no symbol`)
    return { occurredAt, symbol: symbol === '' ? null : symbol, quantity: '1', unitPrice: input.amount, fee: '0' }
  }
  if (input.amount !== undefined) throw new Error('Amount is only for cash movements')
  if (!symbol) throw new Error('Symbol is required')
  if (!isPositive(input.quantity)) throw new Error(`Invalid quantity: ${input.quantity}`)
  if (!isDecimal(input.unitPrice)) throw new Error(`Invalid unit price: ${input.unitPrice}`)
  const fee = input.fee ?? '0'
  if (!isDecimal(fee)) throw new Error(`Invalid fee: ${fee}`)
  return { occurredAt, symbol, quantity: input.quantity, unitPrice: input.unitPrice, fee }
}

export async function addTransaction(sql: Sql, input: TransactionInput): Promise<{ id: string }> {
  const entry = validate(input)
  return sql.begin(async (tx) => {
    await ensureLedgerSchema(tx)
    // Serialises concurrent entries for one account so the holdings check below sees every earlier row.
    const [account] = await tx`SELECT id FROM accounts WHERE id = ${input.accountId} FOR UPDATE`
    if (!account) throw new Error(`Account not found: ${input.accountId}`)
    if (!input.force) {
      // numeric equality makes 2.0 and 2 the same entry; the account lock above keeps two identical entries from both passing.
      const [twin] = await tx`SELECT id FROM transactions WHERE account_id = ${input.accountId} AND type = ${input.type}
        AND symbol IS NOT DISTINCT FROM ${entry.symbol} AND currency = ${input.currency} AND quantity = ${entry.quantity}
        AND unit_price = ${entry.unitPrice} AND fee = ${entry.fee} AND occurred_at = ${entry.occurredAt} LIMIT 1`
      if (twin) throw new DuplicateTransactionError('Duplicate transaction: an identical one is already saved; pass --force to save it again')
    }
    const [row] = await tx`INSERT INTO transactions (account_id, type, symbol, data_source, currency, quantity, unit_price, fee, occurred_at, comment)
      VALUES (${input.accountId}, ${input.type}, ${entry.symbol}, ${entry.symbol === null ? null : 'YAHOO'}, ${input.currency},
        ${entry.quantity}, ${entry.unitPrice}, ${entry.fee}, ${entry.occurredAt}, ${input.comment ?? null})
      RETURNING id`
    if (input.type === 'SELL') {
      // A sale must be covered at every point in time, which also catches a backdated sale that starves a later one.
      const [check] = await tx`SELECT coalesce(bool_or(held < 0), false) AS oversold FROM (
        SELECT sum(CASE type WHEN 'BUY' THEN quantity ELSE -quantity END) OVER (ORDER BY occurred_at, type = 'SELL', seq) AS held
        FROM transactions WHERE account_id = ${input.accountId} AND symbol = ${entry.symbol} AND type IN ('BUY', 'SELL')) timeline`
      if (check.oversold) throw new Error('Cannot sell more than is held')
    }
    return { id: row.id as string }
  })
}

export async function listAccounts(sql: Sql): Promise<{ id: string; name: string; currency: string; comment: string | null }[]> {
  // Reading must not create the ledger, so an empty database answers without touching the schema.
  const [{ name }] = await sql`SELECT to_regclass('accounts') AS name`
  if (name === null) return []
  const rows = await sql`SELECT id, name, currency, comment FROM accounts ORDER BY name, created_at`
  return rows.map((row) => ({ id: row.id, name: row.name, currency: row.currency, comment: row.comment }))
}

// A symbol with no cached quote or history cannot be valued until the worker has fetched it. Both cache tables are
// created by the worker, so either may be missing on a fresh database.
export async function hasCachedPrice(sql: Sql, symbol: string): Promise<boolean> {
  for (const table of ['security_quotes', 'security_prices']) {
    const [{ name }] = await sql`SELECT to_regclass(${table}) AS name`
    if (name === null) continue
    const [found] = await sql`SELECT 1 FROM ${sql(table)} WHERE symbol = ${symbol} LIMIT 1`
    if (found) return true
  }
  return false
}
