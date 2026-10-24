import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Sql } from 'postgres'
import { describe, expect, it } from 'vitest'
import { runImportCli } from './import-cli'
import { isolatedDatabase, withIsolatedDatabase } from './test-support/schema'

function exportFor(label: string, extraActivities = 0) {
  const trade = { accountId: label, type: 'BUY', symbol: `SYNTHETIC-${label}`, dataSource: 'YAHOO', currency: 'EUR', quantity: 2, unitPrice: 10, fee: 0, date: '1980-01-02T10:00:00.000Z', comment: null, tags: [] }
  return JSON.stringify({
    meta: { version: '0.0.1', date: '1980-01-02T12:00:00.000Z' },
    accounts: [{ id: label, name: 'Synthetic broker', currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded: false, platformId: null }],
    activities: Array.from({ length: 1 + extraActivities }, (_, index) => ({ ...trade, date: `1980-01-0${2 + index}T10:00:00.000Z` })),
    assetProfiles: [], platforms: [], tags: [],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  })
}

const read = (text: string) => async () => text

describe('runImportCli', () => {
  it('imports an export and reports created, skipped and rejected counts', async () => {
    await withIsolatedDatabase(async (sql) => {
      const output = await runImportCli(sql, ['export.json'], read(exportFor(crypto.randomUUID(), 1)))
      expect(output.split('\n')).toEqual([
        'outcome\taccounts\tactivities', 'created\t1\t2', 'skipped\t0\t0', 'rejected\t0\t0', '',
      ])
    })
  })

  it('reports the same export as skipped the second time without duplicate rows', async () => {
    await withIsolatedDatabase(async (sql) => {
      const text = exportFor(crypto.randomUUID())
      await runImportCli(sql, ['export.json'], read(text))
      const output = await runImportCli(sql, ['export.json'], read(text))
      expect(output.split('\n').slice(1, 4)).toEqual(['created\t0\t0', 'skipped\t1\t1', 'rejected\t0\t0'])
      expect((await sql`SELECT count(*)::int AS n FROM transactions`)[0].n).toBe(1)
    })
  })

  it('counts only the new activities of an extended export as created', async () => {
    await withIsolatedDatabase(async (sql) => {
      const label = crypto.randomUUID()
      await runImportCli(sql, ['export.json'], read(exportFor(label)))
      const output = await runImportCli(sql, ['export.json'], read(exportFor(label, 2)))
      expect(output.split('\n').slice(1, 4)).toEqual(['created\t0\t2', 'skipped\t1\t1', 'rejected\t0\t0'])
    })
  })

  it('rejects a malformed export with a clear error before touching the database', async () => {
    const untouched = (() => { throw new Error('database used') }) as unknown as Sql
    await expect(runImportCli(untouched, ['export.json'], read('{"accounts": "nope"}'))).rejects.toThrow(/^Import rejected: /)
    await expect(runImportCli(untouched, ['export.json'], read('not json'))).rejects.toThrow(/^Import rejected: /)
  })

  it('fails with the usage line unless exactly one path is given', async () => {
    const untouched = (() => { throw new Error('database used') }) as unknown as Sql
    await expect(runImportCli(untouched, [], read(''))).rejects.toThrow('Usage: import:ghostfolio <export.json>')
    await expect(runImportCli(untouched, ['a', 'b'], read(''))).rejects.toThrow('Usage: import:ghostfolio <export.json>')
  })

  it('reports an unreadable file without echoing its contents', async () => {
    const unreadable = async () => { throw new Error('EACCES: permission denied, open /secret/path') }
    const untouched = (() => { throw new Error('database used') }) as unknown as Sql
    await expect(runImportCli(untouched, ['missing.json'], unreadable)).rejects.toThrow('Cannot read missing.json')
  })
})

describe('import:ghostfolio entry point', () => {
  function run(args: string[], env: Record<string, string | undefined>) {
    return spawnSync('node_modules/.bin/tsx', ['src/cli/import.ts', ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  }

  it('imports a file end to end and exits non-zero on bad input', async () => {
    const { url, drop } = await isolatedDatabase()
    const directory = mkdtempSync(join(tmpdir(), 'import-cli-'))
    try {
      const good = join(directory, 'good.json')
      const bad = join(directory, 'bad.json')
      writeFileSync(good, exportFor(crypto.randomUUID()))
      writeFileSync(bad, '{}')
      const env = { DATABASE_URL: url }
      const ok = run([good], env)
      expect(ok.status).toBe(0)
      expect(ok.stdout).toContain('created\t1\t1')
      const rejected = run([bad], env)
      expect(rejected.status).toBe(1)
      expect(rejected.stderr).toContain('Import rejected')
      const unconfigured = run([good], { DATABASE_URL: undefined })
      expect(unconfigured.status).toBe(1)
      expect(unconfigured.stderr).toContain('DATABASE_URL is required')
    } finally {
      rmSync(directory, { recursive: true, force: true })
      await drop()
    }
  })
})
