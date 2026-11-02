import { transactionsExport } from '../../../../src/transactions-export'
import { openReadOnly } from '../../../../src/valuation-cli'

export const dynamic = 'force-dynamic'
const sql = openReadOnly(process.env.DATABASE_URL ?? '')

export async function GET(request: Request) {
  return transactionsExport(request, { sql, secret: process.env.SESSION_SECRET ?? '', now: Date.now() })
}
