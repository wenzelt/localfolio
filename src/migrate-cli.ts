import type { Sql } from 'postgres'
import { migrateSnapshots } from './snapshot-migration'

export async function runMigrateCli(sql: Sql, args: string[]) {
  if (args.length !== 0) throw new Error('Usage: migrate:snapshots')
  const { snapshots, created, skipped } = await migrateSnapshots(sql)
  const counts = (value: { accounts: number; activities: number }) => `${value.accounts}\t${value.activities}`
  return [`snapshots\t${snapshots}`, 'outcome\taccounts\tactivities', `created\t${counts(created)}`, `skipped\t${counts(skipped)}`, ''].join('\n')
}
