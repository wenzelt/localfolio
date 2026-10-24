import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { importGhostfolioExport, readLedger } from './ledger-store'
import { readPositionReport } from './positions'
import { withIsolatedDatabase } from './test-support/schema'

function fixture(label: string) {
  return {
    meta: { version: '0.0.1', date: '2026-01-02T12:00:00.000Z' },
    accounts: [{ id: label, name: 'Synthetic broker', currency: 'EUR', balance: 10,
      balances: [{ date: '2026-01-01T00:00:00.000Z', value: 10 }],
      comment: null, isExcluded: false, platformId: null }],
    assetProfiles: [], platforms: [], tags: [{ id: 'etf', name: 'ETF' }],
    activities: [{ accountId: label, type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO',
      currency: 'USD', quantity: 2.8, unitPrice: 81, fee: 1.25,
      date: '2026-01-02T10:00:00.000Z', comment: 'Synthetic', tags: ['etf'] }],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }
}

type Fixture = ReturnType<typeof fixture>
async function inLedger(change: (value: Fixture) => void, check: (sql: Sql, accountIds: string[], value: Fixture) => Promise<void>) {
  await withIsolatedDatabase(async (sql) => {
    const value = fixture(crypto.randomUUID())
    change(value)
    await importGhostfolioExport(sql, JSON.stringify(value))
    await check(sql, (await readLedger(sql)).accounts.map((account) => account.id), value)
  })
}

describe('position report from the ledger', () => {
  it('reports costs and realised gains from chronologically sorted saved trades', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities = [
        { ...buy, type: 'SELL', quantity: 1, unitPrice: 15, fee: 1, date: '2026-01-03T10:00:00.000Z' },
        { ...buy, quantity: 2, unitPrice: 10, fee: 2 },
      ]
    }, async (sql, [accountId]) => {
      expect(await readPositionReport(sql)).toEqual([
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'EXAMPLE', status: 'calculated', currency: 'USD', quantity: '1',
          invested: '11', averageCost: '11', realizedGain: '3' },
      ])
    })
  })

  it('flags mixed-currency positions without suppressing other positions', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities.push({ ...buy, type: 'SELL', quantity: 1, currency: 'EUR' })
      value.activities.push({ ...buy, symbol: 'OTHER', quantity: 1, unitPrice: 10, fee: 0 })
    }, async (sql, [accountId]) => {
      expect(await readPositionReport(sql)).toEqual([
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'EXAMPLE', status: 'historical-fx-required' },
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'OTHER', status: 'calculated', currency: 'USD', quantity: '1',
          invested: '10', averageCost: '10', realizedGain: '0' },
      ])
    })
  })

  it('retains account identity, exclusion flags and closed-position gains', async () => {
    await inLedger((value) => {
      value.accounts[0].isExcluded = true
      value.activities.push({ ...value.activities[0], type: 'SELL' })
      const secondId = crypto.randomUUID()
      value.accounts.push({ ...value.accounts[0], id: secondId, name: 'Second account', isExcluded: false })
      value.activities.push({ ...value.activities[0], accountId: secondId })
    }, async (sql, [first, second]) => {
      const report = await readPositionReport(sql)
      expect(report).toHaveLength(2)
      expect(report).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: first, isExcluded: true, quantity: '0', invested: '0', realizedGain: '-2.5' }),
        expect.objectContaining({ accountId: second, accountName: 'Second account', quantity: '2.8' }),
      ]))
    })
  })

  it('keeps exact fractional quantities after a partial sale', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities = [
        { ...buy, quantity: 0.1 },
        { ...buy, quantity: 0.2 },
        { ...buy, quantity: 0.1, type: 'SELL', currency: 'USD' },
      ]
    }, async (sql) => {
      expect(await readPositionReport(sql)).toEqual([expect.objectContaining({ symbol: 'EXAMPLE', quantity: '0.2' })])
    })
  })

  it('returns an empty report for an empty ledger or one without activities', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await readPositionReport(sql)).toEqual([])
    })
    await inLedger((value) => { value.activities = [] }, async (sql) => {
      expect(await readPositionReport(sql)).toEqual([])
    })
  })

  it('ignores cash movements, which carry no instrument', async () => {
    await inLedger(() => {}, async (sql, [accountId]) => {
      await sql`INSERT INTO transactions (account_id, type, currency, quantity, unit_price, fee, occurred_at)
        VALUES (${accountId}, 'DEPOSIT', 'EUR', 1, 500, 0, '2026-01-01T09:00:00Z')`
      expect(await readPositionReport(sql)).toHaveLength(1)
    })
  })

  it('reports mixed trades in EUR using historical UTC-date rates', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities = [
        { ...buy, quantity: 2, unitPrice: 10, fee: 2 },
        { ...buy, type: 'SELL', currency: 'EUR', quantity: 1, unitPrice: 15, fee: 1, date: '2026-01-03T10:00:00.000Z' },
      ]
    }, async (sql, [accountId]) => {
      expect(await readPositionReport(sql, { '2026-01-02': '0.9' })).toEqual([
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'EXAMPLE', status: 'calculated', currency: 'EUR', quantity: '1',
          invested: '9.9', averageCost: '9.9', realizedGain: '4.1' },
      ])
    })
  })

  it('keeps the native USD cost basis of a USD-only holding next to its EUR cost basis', async () => {
    await inLedger(() => {}, async (sql) => {
      expect(await readPositionReport(sql, { '2026-01-02': '0.9' })).toEqual([
        expect.objectContaining({ symbol: 'EXAMPLE', currency: 'EUR', invested: '205.245', nativeInvested: '228.05' }),
      ])
    })
  })

  it('has no native cost basis when a holding is in EUR or mixes currencies', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities = [buy, { ...buy, symbol: 'EURO', currency: 'EUR', quantity: 1, unitPrice: 10, fee: 0 },
        { ...buy, symbol: 'MIXED', currency: 'EUR', quantity: 1, unitPrice: 10, fee: 0 },
        { ...buy, symbol: 'MIXED', quantity: 1, unitPrice: 10, fee: 0 }]
    }, async (sql) => {
      const report = await readPositionReport(sql, { '2026-01-02': '0.9' })
      expect(report.map((position) => [position.symbol, 'nativeInvested' in position]))
        .toEqual([['EURO', false], ['EXAMPLE', true], ['MIXED', false]])
    })
  })

  it('flags missing historical dates without blocking EUR-only positions', async () => {
    await inLedger((value) => {
      const buy = value.activities[0]
      value.activities.push({ ...buy, symbol: 'EURO', currency: 'EUR', quantity: 1, unitPrice: 10, fee: 0 })
    }, async (sql, [accountId]) => {
      expect(await readPositionReport(sql, { '2026-01-01': '0.9' })).toEqual([
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'EURO', status: 'calculated', currency: 'EUR', quantity: '1',
          invested: '10', averageCost: '10', realizedGain: '0' },
        { accountId, accountName: 'Synthetic broker', isExcluded: false,
          symbol: 'EXAMPLE', status: 'historical-fx-required' },
      ])
    })
  })
})
