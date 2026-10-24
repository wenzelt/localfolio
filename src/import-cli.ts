import type { Sql } from 'postgres'
import { parseGhostfolioJson } from './ghostfolio'
import { importGhostfolioExport } from './ledger-store'

export async function runImportCli(sql: Sql, args: string[], readText: (path: string) => Promise<string>) {
  if (args.length !== 1) throw new Error('Usage: import:ghostfolio <export.json>')
  const [path] = args
  let text: string
  try {
    text = await readText(path)
  } catch {
    throw new Error(`Cannot read ${path}`)
  }
  // Validate first so only genuine validation failures are reported as rejected; database errors propagate as they are.
  try {
    parseGhostfolioJson(text)
  } catch (error) {
    throw new Error(`Import rejected: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { created, skipped } = await importGhostfolioExport(sql, text)
  const counts = (value: { accounts: number; activities: number }) => `${value.accounts}\t${value.activities}`
  return ['outcome\taccounts\tactivities', `created\t${counts(created)}`, `skipped\t${counts(skipped)}`, 'rejected\t0\t0', ''].join('\n')
}
