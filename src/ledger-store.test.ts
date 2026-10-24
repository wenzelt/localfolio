import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { importGhostfolioExport, readLedger } from './ledger-store'
import { isolatedDatabase } from './test-support/schema'

let sql: Sql
let drop: () => Promise<void>
beforeAll(async () => ({ sql, drop } = await isolatedDatabase()))
afterAll(() => drop())

function exportOf(overrides: { accounts?: unknown[]; activities?: unknown[] } = {}) {
  return JSON.stringify({
    meta: { version: '0.0.1', date: '2026-01-02T12:00:00.000Z' },
    accounts: overrides.accounts ?? [{ id: 'acc-1', name: 'Synthetic broker', currency: 'EUR', balance: 10.5,
      balances: [{ date: '2026-01-01T00:00:00.000Z', value: 10.25 }, { date: '2026-01-02T00:00:00.000Z', value: 10.5 }],
      comment: 'Main', isExcluded: true, platformId: null }],
    assetProfiles: [], platforms: [], tags: [{ id: 'etf', name: 'ETF' }, { id: 'unused', name: 'Unused' }],
    activities: overrides.activities ?? [{ accountId: 'acc-1', type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO',
      currency: 'USD', quantity: 2.8, unitPrice: 81.1, fee: 1.25,
      date: '2026-01-02T10:00:00.000Z', comment: 'Synthetic', tags: ['etf'] }],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  })
}

describe('normalized ledger import', () => {
  it('stores accounts, balance snapshots, tags and activities with exact decimals', async () => {
    const result = await importGhostfolioExport(sql, exportOf())
    expect(result.created).toEqual({ accounts: 1, balances: 2, tags: 2, activities: 1 })
    expect(result.skipped).toEqual({ accounts: 0, balances: 0, tags: 0, activities: 0 })

    const ledger = await readLedger(sql)
    expect(ledger.accounts).toHaveLength(1)
    expect(ledger.accounts[0]).toMatchObject({ externalId: 'acc-1', name: 'Synthetic broker', currency: 'EUR',
      balance: '10.5', comment: 'Main', isExcluded: true })
    expect(ledger.accounts[0].balances).toEqual([
      { date: '2026-01-01T00:00:00.000Z', value: '10.25' },
      { date: '2026-01-02T00:00:00.000Z', value: '10.5' },
    ])
    expect(ledger.activities).toEqual([expect.objectContaining({
      accountId: ledger.accounts[0].id, type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO', currency: 'USD',
      quantity: '2.8', unitPrice: '81.1', fee: '1.25', date: '2026-01-02T10:00:00.000Z', comment: 'Synthetic', tags: ['ETF'],
    })])
  })

  it('creates nothing when the same export is imported again', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      await importGhostfolioExport(fresh, exportOf())
      const again = await importGhostfolioExport(fresh, exportOf())
      expect(again.created).toEqual({ accounts: 0, balances: 0, tags: 0, activities: 0 })
      expect(again.skipped).toEqual({ accounts: 1, balances: 2, tags: 2, activities: 1 })
      for (const table of ['accounts', 'account_balances', 'tags', 'transactions', 'transaction_tags']) {
        expect(Number((await fresh.unsafe(`SELECT count(*) AS n FROM ${table}`))[0].n)).toBe(table === 'tags' ? 2 : table === 'account_balances' ? 2 : 1)
      }
    } finally {
      await dropFresh()
    }
  })

  it('imports only the new activities of a partly overlapping export', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      const sale = { accountId: 'acc-1', type: 'SELL', symbol: 'EXAMPLE', dataSource: 'YAHOO', currency: 'USD', quantity: 1,
        unitPrice: 90, fee: 0, date: '2026-01-03T10:00:00.000Z', comment: null, tags: [] }
      const buy = JSON.parse(exportOf()).activities[0]
      await importGhostfolioExport(fresh, exportOf({ activities: [buy] }))
      const second = await importGhostfolioExport(fresh, exportOf({ activities: [buy, sale] }))
      expect(second.created.activities).toBe(1)
      expect(second.skipped.activities).toBe(1)
      expect((await readLedger(fresh)).activities.map((activity) => activity.type)).toEqual(['BUY', 'SELL'])
    } finally {
      await dropFresh()
    }
  })

  it('keeps identical activities that occur twice within one export', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      const buy = JSON.parse(exportOf()).activities[0]
      const first = await importGhostfolioExport(fresh, exportOf({ activities: [buy, buy] }))
      expect(first.created.activities).toBe(2)
      const again = await importGhostfolioExport(fresh, exportOf({ activities: [buy, buy] }))
      expect(again.created.activities).toBe(0)
      expect((await readLedger(fresh)).activities).toHaveLength(2)
    } finally {
      await dropFresh()
    }
  })

  it('rolls everything back when the database rejects a later row', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      const buy = JSON.parse(exportOf()).activities[0]
      // A NUL character passes export validation but PostgreSQL text cannot store it.
      const poisoned = { ...buy, date: '2026-01-04T10:00:00.000Z', comment: 'bad\u0000comment' }
      await expect(importGhostfolioExport(fresh, exportOf({ activities: [buy, poisoned] }))).rejects.toThrow()
      const tables = await fresh`SELECT to_regclass('accounts') AS accounts`
      if (tables[0].accounts !== null) {
        expect(Number((await fresh`SELECT count(*) AS n FROM accounts`)[0].n)).toBe(0)
        expect(Number((await fresh`SELECT count(*) AS n FROM transactions`)[0].n)).toBe(0)
      }
    } finally {
      await dropFresh()
    }
  })

  it.each(['version', 'quantity', 'currency', 'type', 'account'])('rejects invalid %s without changing imported tables', async (field) => {
    const tables = ['accounts', 'account_balances', 'tags', 'transactions', 'transaction_tags']
    const counts = () => Promise.all(tables.map(async (table) =>
      Number((await sql.unsafe(`SELECT count(*) AS n FROM ${table}`))[0].n)))
    const before = await counts()
    const value = JSON.parse(exportOf())
    value.accounts[0].id = 'must-not-persist'
    value.activities[0].accountId = 'must-not-persist'
    if (field === 'version') value.meta.version = '9.9.9'
    if (field === 'quantity') value.activities[0].quantity = -1
    if (field === 'currency') value.activities[0].currency = 'GBP'
    if (field === 'type') value.activities[0].type = 'TRANSFER'
    if (field === 'account') value.activities[0].accountId = 'missing'
    await expect(importGhostfolioExport(sql, JSON.stringify(value))).rejects.toThrow()
    expect(await counts()).toEqual(before)
  })

  it('rejects a malformed export before creating any table', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      await expect(importGhostfolioExport(fresh, '{"meta":')).rejects.toThrow()
      expect((await fresh`SELECT to_regclass('accounts') AS name`)[0].name).toBeNull()
    } finally {
      await dropFresh()
    }
  })

})

describe('empty ledger', () => {
  it('reads as empty when the schema does not exist yet', async () => {
    const { sql: fresh, drop: dropFresh } = await isolatedDatabase()
    try {
      expect(await readLedger(fresh)).toEqual({ accounts: [], activities: [] })
    } finally {
      await dropFresh()
    }
  })
})
