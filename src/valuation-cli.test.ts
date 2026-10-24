import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { importGhostfolioExport } from './ledger-store'
import { cacheTables, isolatedDatabase } from './test-support/schema'
import { openReadOnly, runValuationCli } from './valuation-cli'

const header = 'account\tsymbol\tstatus\tquantity\tinvested\tmarketValue\tunrealizedGain'
const usage = 'Usage: report:valuation <YYYY-MM-DD>'

// One committed ledger for the whole file, so the spawned process and the in-process calls see the same rows.
let sql: Sql
let url: string
let drop: () => Promise<void>
const symbol = `SYNTHETIC-${crypto.randomUUID()}`

beforeAll(async () => {
  ;({ sql, url, drop } = await isolatedDatabase())
  const accountId = crypto.randomUUID()
  const trade = { accountId, type: 'BUY', symbol, dataSource: 'YAHOO', currency: 'EUR', quantity: 2, unitPrice: 10, fee: 1, date: '1980-01-02T10:00:00.000Z', comment: null, tags: [] }
  await importGhostfolioExport(sql, JSON.stringify({
    meta: { version: '0.0.1', date: '1980-01-02T12:00:00.000Z' },
    accounts: [{ id: accountId, name: 'Synthetic broker', currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded: false, platformId: null }],
    activities: [trade],
    assetProfiles: [], platforms: [], tags: [],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }))
  await sql.unsafe(cacheTables)
  await sql`INSERT INTO security_quotes VALUES (${symbol}, '1980-01-10', 15, 'EUR', 'yfinance', now())`
})
afterAll(() => drop())

describe('runValuationCli', () => {
  it('prints a tab-separated EUR valuation table for a date', async () => {
    const output = await runValuationCli(sql, ['1980-01-10'])
    const [head, row, ...rest] = output.split('\n')
    expect(head).toBe(header)
    expect(row.split('\t')).toEqual(['Synthetic broker', symbol, 'valued', '2', '21', '30', '9'])
    expect(rest).toEqual([''])
  })

  it('leaves valuation cells empty when the status is not valued', async () => {
    await sql`DELETE FROM security_quotes`
    try {
      const output = await runValuationCli(sql, ['1980-01-10'])
      expect(output.split('\n')[1].split('\t')).toEqual(['Synthetic broker', symbol, 'quote-required', '2', '21', '', ''])
    } finally {
      await sql`INSERT INTO security_quotes VALUES (${symbol}, '1980-01-10', 15, 'EUR', 'yfinance', now())`
    }
  })

  it('reports an empty ledger', async () => {
    const { sql: empty, drop: dropEmpty } = await isolatedDatabase()
    try {
      await expect(runValuationCli(empty, ['1980-01-10'])).rejects.toThrow('Ledger is empty')
    } finally {
      await dropEmpty()
    }
  })

  it('rejects wrong arguments with usage', async () => {
    await expect(runValuationCli(sql, [])).rejects.toThrow(usage)
    await expect(runValuationCli(sql, ['a', 'b'])).rejects.toThrow(usage)
  })

  it('rejects an invalid date', async () => {
    await expect(runValuationCli(sql, ['1980-02-31'])).rejects.toThrow('Invalid valuation date')
  })
})

describe('openReadOnly', () => {
  it('rejects writes on the connection', async () => {
    const readOnly = openReadOnly(url)
    try {
      await expect(readOnly`INSERT INTO accounts (name, currency) VALUES ('probe', 'EUR')`).rejects.toThrow('read-only transaction')
      expect(await readOnly`SELECT 1 AS one`).toEqual([{ one: 1 }])
    } finally {
      await readOnly.end()
    }
  })
})

describe('valuation CLI process', () => {
  const run = (args: string[]) => spawnSync('node_modules/.bin/tsx', ['src/cli/valuation.ts', ...args], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  })

  it('prints the report and exits 0', () => {
    const result = run(['1980-01-10'])
    expect(result.status).toBe(0)
    const [head, row] = result.stdout.split('\n')
    expect(head).toBe(header)
    expect(row.split('\t').slice(0, 3)).toEqual(['Synthetic broker', symbol, 'valued'])
  })

  it('prints the error on stderr and exits 1', () => {
    const result = run(['not-a-date'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid valuation date')
    expect(result.stdout).toBe('')
  })

  it('is exposed as an npm script', () => {
    const scripts = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json").scripts)'], { encoding: 'utf8' }))
    expect(scripts['report:valuation']).toContain('src/cli/valuation.ts')
  })
})
