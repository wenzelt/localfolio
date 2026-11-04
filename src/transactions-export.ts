import type { Sql } from 'postgres'
import { readLedger } from './ledger-store'
import { localDate } from './local-date'
import { transactionsCsv } from './transactions-csv'
import { refuse, reply } from './route-guard'
import type { Session } from './route-guard'

// Without a byte order mark Excel guesses a legacy encoding and garbles accented names and euro signs.
const byteOrderMark = '﻿'

export async function transactionsExport(request: Request, { sql, ...session }: Session & { sql: Sql }): Promise<Response> {
  const refused = refuse(request, session, { write: false })
  if (refused) return refused
  try {
    const { accounts, activities } = await readLedger(sql)
    return new Response(byteOrderMark + transactionsCsv(accounts, activities), { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="localfolio-transactions-${localDate(session.now)}.csv"`,
      'cache-control': 'no-store',
    } })
  } catch {
    return reply(500, { error: 'The transactions could not be exported' })
  }
}
