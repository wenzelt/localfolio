import type { Sql } from 'postgres'
import { addAccount, deleteAccount, DuplicateAccountError, InvalidAccountError } from './accounts'
import { authenticated, sameOrigin } from './web-auth'

type Deps = { sql: Sql; secret: string; now: number }

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Shared checks for both writes: signed in, same origin, and a JSON object body.
async function guarded(request: Request, { secret, now }: Deps, invalid: string): Promise<Response | Record<string, unknown>> {
  if (!authenticated(request.headers.get('cookie'), secret, now)) return reply(401, { error: 'Not signed in' })
  if (!sameOrigin(request)) return reply(403, { error: 'Forbidden' })
  let body: unknown
  try { body = await request.json() } catch { return reply(400, { error: invalid }) }
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : reply(400, { error: invalid })
}

export async function postAccountRequest(request: Request, deps: Deps): Promise<Response> {
  const body = await guarded(request, deps, 'Invalid account')
  if (body instanceof Response) return body
  const { name, currency, comment } = body
  if (typeof name !== 'string' || typeof currency !== 'string' || (comment !== undefined && comment !== null && typeof comment !== 'string')) return reply(400, { error: 'Invalid account' })
  try {
    return reply(201, await addAccount(deps.sql, { name, currency, comment: comment ?? undefined }))
  } catch (error) {
    if (error instanceof DuplicateAccountError) return reply(409, { error: error.message })
    if (error instanceof InvalidAccountError) return reply(400, { error: error.message })
    return reply(500, { error: 'The account could not be added' })
  }
}

export async function deleteAccountRequest(request: Request, deps: Deps): Promise<Response> {
  const body = await guarded(request, deps, 'Invalid deletion request')
  if (body instanceof Response) return body
  const { accountId, confirm } = body
  if (typeof accountId !== 'string' || !uuid.test(accountId) || typeof confirm !== 'string' || confirm === '') return reply(400, { error: 'Type the exact account name to confirm deletion' })
  try {
    const outcome = await deleteAccount(deps.sql, accountId, confirm)
    if (outcome.status === 'not-found') return reply(404, { error: 'Account not found' })
    if (outcome.status === 'mismatch') return reply(400, { error: 'Type the exact account name to confirm deletion' })
    return reply(200, { deleted: outcome.transactions })
  } catch {
    return reply(500, { error: 'The account could not be deleted' })
  }
}
