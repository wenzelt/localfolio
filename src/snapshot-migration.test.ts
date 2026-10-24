import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { readLedger } from './ledger-store'
import { runMigrateCli } from './migrate-cli'
import { migrateSnapshots } from './snapshot-migration'
import { isolatedDatabase, withIsolatedDatabase } from './test-support/schema'

function snapshot(label: string, activityCount = 1) {
  const buy = { accountId: label, type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO', currency: 'USD', quantity: 2.8, unitPrice: 81.1, fee: 1.25, comment: 'Synthetic', tags: ['etf'] }
  return {
    meta: { version: '0.0.1', date: '2026-01-02T12:00:00.000Z' },
    accounts: [{ id: label, name: 'Synthetic broker', currency: 'EUR', balance: 10.5,
      balances: [{ date: '2026-01-01T00:00:00.000Z', value: 10.25 }], comment: null, isExcluded: false, platformId: null }],
    assetProfiles: [], platforms: [], tags: [{ id: 'etf', name: 'ETF' }],
    activities: Array.from({ length: activityCount }, (_, index) => ({ ...buy, date: `2026-01-0${2 + index}T10:00:00.000Z` })),
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }
}

async function legacyTable(sql: Sql, documents: unknown[]) {
  await sql`CREATE TABLE ghostfolio_imports (id text PRIMARY KEY, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`
  for (const [index, document] of documents.entries()) {
    await sql`INSERT INTO ghostfolio_imports (id, document, created_at) VALUES (${`snapshot-${index}`}, ${sql.json(document as never)}, now() + ${index} * interval '1 second')`
  }
}

describe('snapshot migration', () => {
  it('moves a stored snapshot into the normalized tables', async () => {
    await withIsolatedDatabase(async (sql) => {
      await legacyTable(sql, [snapshot('acc-1')])
      const result = await migrateSnapshots(sql)
      expect(result).toMatchObject({ snapshots: 1, created: { accounts: 1, balances: 1, tags: 1, activities: 1 } })
      const ledger = await readLedger(sql)
      expect(ledger.accounts[0]).toMatchObject({ externalId: 'acc-1', balance: '10.5', balances: [{ date: '2026-01-01T00:00:00.000Z', value: '10.25' }] })
      expect(ledger.activities[0]).toMatchObject({ quantity: '2.8', unitPrice: '81.1', fee: '1.25', tags: ['ETF'] })
    })
  })

  it('is idempotent and leaves the original snapshots untouched', async () => {
    await withIsolatedDatabase(async (sql) => {
      await legacyTable(sql, [snapshot('acc-1')])
      const before = await sql`SELECT id, document::text AS document, created_at FROM ghostfolio_imports ORDER BY id`
      await migrateSnapshots(sql)
      const again = await migrateSnapshots(sql)
      expect(again.created).toEqual({ accounts: 0, balances: 0, tags: 0, activities: 0 })
      expect(again.skipped).toMatchObject({ accounts: 1, activities: 1 })
      expect(await sql`SELECT id, document::text AS document, created_at FROM ghostfolio_imports ORDER BY id`).toEqual(before)
      expect((await readLedger(sql)).activities).toHaveLength(1)
    })
  })

  it('merges overlapping snapshots without duplicating shared records', async () => {
    await withIsolatedDatabase(async (sql) => {
      await legacyTable(sql, [snapshot('acc-1', 1), snapshot('acc-1', 2)])
      const result = await migrateSnapshots(sql)
      expect(result).toMatchObject({
        snapshots: 2,
        created: { accounts: 1, activities: 2 },
        skipped: { accounts: 1, activities: 1 },
      })
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })

  it('does nothing when there is no legacy table', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await migrateSnapshots(sql)).toEqual({
        snapshots: 0,
        created: { accounts: 0, balances: 0, tags: 0, activities: 0 },
        skipped: { accounts: 0, balances: 0, tags: 0, activities: 0 },
      })
      expect((await sql`SELECT to_regclass('accounts') AS name`)[0].name).toBeNull()
    })
  })

  it('names the snapshot it cannot migrate and keeps the earlier ones', async () => {
    await withIsolatedDatabase(async (sql) => {
      await legacyTable(sql, [snapshot('acc-1'), { meta: { version: '9' } }])
      await expect(migrateSnapshots(sql)).rejects.toThrow(/^Snapshot snapshot-1 cannot be migrated: /)
      expect((await readLedger(sql)).activities).toHaveLength(1)
    })
  })
})

describe('migrate:snapshots command', () => {
  it('reports snapshot, created and skipped counts', async () => {
    await withIsolatedDatabase(async (sql) => {
      await legacyTable(sql, [snapshot('acc-1')])
      expect((await runMigrateCli(sql, [])).split('\n')).toEqual([
        'snapshots\t1', 'outcome\taccounts\tactivities', 'created\t1\t1', 'skipped\t0\t0', '',
      ])
      expect((await runMigrateCli(sql, [])).split('\n')).toEqual([
        'snapshots\t1', 'outcome\taccounts\tactivities', 'created\t0\t0', 'skipped\t1\t1', '',
      ])
    })
  })

  it('takes no arguments', async () => {
    const untouched = (() => { throw new Error('database used') }) as unknown as Sql
    await expect(runMigrateCli(untouched, ['extra'])).rejects.toThrow('Usage: migrate:snapshots')
  })

  it('runs as a process and is exposed as an npm script', async () => {
    const { sql, url, drop } = await isolatedDatabase()
    try {
      await legacyTable(sql, [snapshot('acc-1')])
      const result = spawnSync('node_modules/.bin/tsx', ['src/cli/migrate.ts'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('created\t1\t1')
      const unconfigured = spawnSync('node_modules/.bin/tsx', ['src/cli/migrate.ts'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: undefined } })
      expect(unconfigured.status).toBe(1)
      expect(unconfigured.stderr).toContain('DATABASE_URL is required')
      const scripts = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8')).scripts
      expect(scripts['migrate:snapshots']).toContain('src/cli/migrate.ts')
    } finally {
      await drop()
    }
  })
})
