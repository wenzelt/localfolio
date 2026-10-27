import postgres from 'postgres'
import { ghostfolioImport } from '../../../../src/ghostfolio-import'

const sql = postgres(process.env.DATABASE_URL ?? '')

export async function POST(request: Request) {
  return ghostfolioImport(request, { sql, secret: process.env.SESSION_SECRET ?? '', now: Date.now() })
}
