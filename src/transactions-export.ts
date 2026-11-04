import type { Sql } from 'postgres'
import { readLedger } from './ledger-store'
import { transactionsCsv } from './transactions-csv'
import { authenticated } from './web-auth'

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

// Without a byte order mark Excel guesses a legacy encoding and garbles accented names and euro signs.
const byteOrderMark = '﻿'

export async function transactionsExport(request: Request, { sql, secret, now }: { sql: Sql; secret: string; now: number }): Promise<Response> {
  if (!authenticated(request.headers.get('cookie'), secret, now)) return reply(401, { error: 'Not signed in' })
  try {
    const { accounts, activities } = await readLedger(sql)
    return new Response(byteOrderMark + transactionsCsv(accounts, activities), { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="localfolio-transactions-${new Date(now).toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    } })
  } catch {
    return reply(500, { error: 'The transactions could not be exported' })
  }
}
