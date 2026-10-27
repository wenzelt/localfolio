import type { Sql } from 'postgres'
import { parseGhostfolioJson } from './ghostfolio'
import { importGhostfolioExport } from './ledger-store'
import { authenticated, sameOrigin } from './web-auth'

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function ghostfolioImport(request: Request, { sql, secret, now }: { sql: Sql; secret: string; now: number }): Promise<Response> {
  if (!authenticated(request.headers.get('cookie'), secret, now)) return reply(401, { error: 'Not signed in' })
  if (!sameOrigin(request)) return reply(403, { error: 'Forbidden' })
  let json: string
  try {
    // Bound the stream before JSON parsing, including clients that omit Content-Length.
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Choose a Ghostfolio export file')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_100_000) { await reader.cancel(); return reply(413, { error: 'Upload is too large (export maximum 2 MiB)' }) }
      chunks.push(value)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body.json !== 'string') throw new Error('Choose a Ghostfolio export file')
    json = body.json
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : 'Invalid import request' })
  }
  // Validate first so only genuine validation failures are reported as rejected.
  try {
    parseGhostfolioJson(json)
  } catch (error) {
    return reply(400, { error: `Import rejected: ${error instanceof Error ? error.message : String(error)}` })
  }
  try {
    return reply(200, await importGhostfolioExport(sql, json))
  } catch {
    return reply(500, { error: 'Import failed and nothing was saved; please try again' })
  }
}
