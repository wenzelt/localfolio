import type { Sql } from 'postgres'
import { parseGhostfolioJson } from './ghostfolio'
import { InputError } from './input-error'
import { importGhostfolioExport } from './ledger-store'
import { boundedText, refuse, reply } from './route-guard'
import type { Session } from './route-guard'

export async function ghostfolioImport(request: Request, { sql, ...session }: Session & { sql: Sql }): Promise<Response> {
  const refused = refuse(request, session, { write: true })
  if (refused) return refused
  let json: string
  try {
    if (!request.body) throw new Error('Choose a Ghostfolio export file')
    const text = await boundedText(request.body, 2_100_000)
    if (text === null) return reply(413, { error: 'Upload is too large (export maximum 2 MiB)' })
    const body = JSON.parse(text)
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
  } catch (error) {
    if (error instanceof InputError) return reply(400, { error: `Import rejected: ${error.message}` })
    return reply(500, { error: 'Import failed and nothing was saved; please try again' })
  }
}
