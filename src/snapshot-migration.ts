import type { Sql } from 'postgres'
import { importGhostfolioExport } from './ledger-store'
import type { Counts } from './ledger-store'

const zero = (): Counts => ({ accounts: 0, balances: 0, tags: 0, activities: 0 })

// Replays each stored snapshot through the normal import. The import is idempotent, so a repeat run only skips,
// and the snapshot table is only ever read.
export async function migrateSnapshots(sql: Sql) {
  const total = { snapshots: 0, created: zero(), skipped: zero() }
  const [table] = await sql`SELECT to_regclass('ghostfolio_imports') AS name`
  if (table.name === null) return total
  const rows = await sql<{ id: string; document: string }[]>`
    SELECT id, document::text AS document FROM ghostfolio_imports ORDER BY created_at, id`
  for (const row of rows) {
    try {
      const { created, skipped } = await importGhostfolioExport(sql, row.document)
      for (const key of Object.keys(total.created) as (keyof Counts)[]) {
        total.created[key] += created[key]
        total.skipped[key] += skipped[key]
      }
    } catch (error) {
      throw new Error(`Snapshot ${row.id} cannot be migrated: ${error instanceof Error ? error.message : String(error)}`)
    }
    total.snapshots++
  }
  return total
}
