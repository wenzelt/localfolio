import postgres from 'postgres'
import { positionsImport } from '../../../../src/positions-import'

const sql = postgres(process.env.DATABASE_URL ?? '')

export async function POST(request: Request) {
  return positionsImport(request, { sql, secret: process.env.SESSION_SECRET ?? '', now: Date.now() })
}
