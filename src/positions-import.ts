import type { Sql } from 'postgres'
import { parsePositionsCsv } from './positions-csv'
import { ensureLedgerSchema } from './ledger-store'
import { InputError } from './input-error'
import { boundedText, refuse, reply } from './route-guard'
import type { Session } from './route-guard'

export async function positionsImport(request: Request, { sql, ...session }: Session & { sql: Sql }): Promise<Response> {
  const refused = refuse(request, session, { write: true })
  if (refused) return refused
  let rows: ReturnType<typeof parsePositionsCsv>
  let action: string
  try {
    if (!request.body) throw new Error('Choose a CSV file')
    const text = await boundedText(request.body, 2_100_000)
    if (text === null) return reply(413, { error: 'Upload is too large (CSV maximum 1 MiB)' })
    const body = JSON.parse(text)
    if (!body || typeof body.csv !== 'string' || !['preview', 'import'].includes(body.action)) throw new Error('Choose a CSV file and preview it before importing')
    action = body.action
    rows = parsePositionsCsv(body.csv, new Date(session.now).toISOString().slice(0, 10))
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : 'Invalid CSV request' })
  }
  try {
    const result = await sql.begin(async (tx) => {
      // Serialize account creation across imports, then share account locks with manual entry/removal.
      await tx`SELECT pg_advisory_xact_lock(713821, 1)`
      const exists = await tx`SELECT to_regclass('accounts') AS name`
      const accounts = exists[0].name ? await tx`SELECT id, name, currency FROM accounts ORDER BY id FOR UPDATE` : []
      const names = [...new Set(rows.map((row) => row.account))]
      for (const name of names) {
        const matches = accounts.filter((account) => account.name === name)
        if (matches.length > 1) throw new InputError(`Account “${name}” is ambiguous; rename duplicate accounts first`)
        if (matches.length === 0 && new Set(rows.filter((row) => row.account === name).map((row) => row.currency)).size > 1) throw new InputError(`New account “${name}” has mixed currencies; create the account first or use one currency`)
      }
      if (action === 'preview') return { rows }
      await ensureLedgerSchema(tx)
      const ids = new Map<string, string>()
      for (const name of names) {
        const existing = accounts.find((account) => account.name === name)
        const currency = rows.find((row) => row.account === name)?.currency ?? 'EUR'
        const account = existing ?? (await tx`INSERT INTO accounts (name, currency) VALUES (${name}, ${currency}) RETURNING id`)[0]
        ids.set(name, account.id as string)
      }
      let created = 0, skipped = 0
      for (const row of rows) {
        const accountId = ids.get(row.account) as string
        const duplicate = await tx`SELECT id FROM transactions WHERE account_id = ${accountId} AND type = 'BUY' AND symbol = ${row.symbol} AND currency = ${row.currency} AND quantity = ${row.quantity}::numeric AND unit_price = ${row.averagePrice}::numeric AND fee = 0 AND occurred_at = ${row.date}::date::timestamp AT TIME ZONE 'UTC' LIMIT 1`
        if (duplicate.length > 0) { skipped++; continue }
        await tx`INSERT INTO transactions (account_id, type, symbol, currency, quantity, unit_price, fee, occurred_at, comment) VALUES (${accountId}, 'BUY', ${row.symbol}, ${row.currency}, ${row.quantity}, ${row.averagePrice}, 0, ${row.date}::date::timestamp AT TIME ZONE 'UTC', 'Positions CSV opening balance')`
        created++
      }
      return { created, skipped }
    })
    return reply(200, result)
  } catch (error) {
    return error instanceof InputError ? reply(400, { error: error.message }) : reply(500, { error: 'The positions could not be imported; no rows were saved' })
  }
}
