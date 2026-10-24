import postgres from 'postgres'
import { removePosition } from '../../../src/remove-position'

const sql = postgres(process.env.DATABASE_URL ?? '')

export async function DELETE(request: Request) {
  return removePosition(request, { sql, secret: process.env.SESSION_SECRET ?? '', now: Date.now() })
}
