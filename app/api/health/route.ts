import { healthResponse } from '../../../src/health'
import { openReadOnly } from '../../../src/valuation-cli'

export const dynamic = 'force-dynamic'
const sql = openReadOnly(process.env.DATABASE_URL ?? '')

export async function GET() {
  return healthResponse(sql)
}
