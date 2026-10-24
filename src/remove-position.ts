import type { Sql } from 'postgres'
import { authenticated, sameOrigin } from './web-auth'

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function removePosition(request: Request, { sql, secret, now }: { sql: Sql; secret: string; now: number }): Promise<Response> {
  if (!authenticated(request.headers.get('cookie'), secret, now)) return reply(401, { error: 'Not signed in' })
  if (!sameOrigin(request)) return reply(403, { error: 'Forbidden' })
  let body: unknown
  try { body = await request.json() } catch { return reply(400, { error: 'Invalid removal request' }) }
  if (typeof body !== 'object' || body === null) return reply(400, { error: 'Invalid removal request' })
  const { accountId, symbol, confirm } = body as Record<string, unknown>
  if (typeof accountId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)
    || typeof symbol !== 'string' || symbol.trim() === '' || confirm !== symbol) return reply(400, { error: 'Type the exact symbol to confirm removal' })
  try {
    const deleted = await sql.begin(async (tx) => {
      // Share the entry lock: a concurrent BUY cannot interleave with removing its history.
      const account = await tx`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`
      if (account.length === 0) return 0
      const rows = await tx`DELETE FROM transactions WHERE account_id = ${accountId} AND symbol = ${symbol} RETURNING id`
      return rows.length
    })
    return deleted === 0 ? reply(404, { error: 'Position not found' }) : reply(200, { deleted })
  } catch {
    return reply(500, { error: 'The position could not be removed' })
  }
}
