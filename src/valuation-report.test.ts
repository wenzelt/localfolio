import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { importGhostfolioExport, readLedger } from './ledger-store'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'
import { readValuationReport } from './valuation-report'

type Options = { tradeCurrency?: string; quoteCurrency?: string; quoteDate?: string; noQuote?: boolean; closed?: boolean; historicalMissing?: boolean; currentMissing?: boolean }
async function setup(sql: Sql, options: Options = {}) {
  const symbol = `SYNTHETIC-${crypto.randomUUID()}`
  const accountId = crypto.randomUUID()
  const trade = { accountId, type: 'BUY', symbol, dataSource: 'YAHOO', currency: options.tradeCurrency ?? 'EUR', quantity: 2, unitPrice: 10, fee: 1, date: '1980-01-02T10:00:00.000Z', comment: null, tags: [] }
  const document = {
    meta: { version: '0.0.1', date: '1980-01-02T12:00:00.000Z' },
    accounts: [{ id: accountId, name: 'Synthetic broker', currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded: true, platformId: null }],
    activities: [trade, ...(options.closed ? [{ ...trade, type: 'SELL', date: '1980-01-02T11:00:00.000Z' }] : [])],
    assetProfiles: [], platforms: [], tags: [],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }
  await importGhostfolioExport(sql, JSON.stringify(document))
  return { symbol, accountId: (await readLedger(sql)).accounts[0].id }
}

async function withCache(options: Options, check: (client: Sql, fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  await withIsolatedDatabase(async (client) => {
    const fixture = await setup(client, options)
    await client.unsafe(cacheTables)
    if (!options.noQuote) await client`INSERT INTO security_quotes VALUES (${fixture.symbol}, ${options.quoteDate ?? '1980-01-10'}, 15, ${options.quoteCurrency ?? 'EUR'}, 'yfinance', now())`
    if (!options.historicalMissing) await client`INSERT INTO fx_observations VALUES ('1980-01-02', 0.8, 'USDEUR=X')`
    if (!options.currentMissing) await client`INSERT INTO fx_observations VALUES ('1980-01-10', 0.9, 'USDEUR=X')`
    await check(client, fixture)
  })
}

describe('cached EUR valuation report', () => {
  it('values EUR holdings preserving identity, exclusions and provenance', async () => {
    await withCache({}, async (client, fixture) => {
      const [row] = await readValuationReport(client, '1980-01-10')
      expect(row).toMatchObject({ accountId: fixture.accountId, symbol: fixture.symbol, isExcluded: true, status: 'valued', currency: 'EUR', marketValue: '30', unrealizedGain: '9', quote: { observedOn: '1980-01-10', source: 'yfinance', fetchedAt: expect.any(String) } })
    })
  })

  it('separates historical trade FX from quote-date FX', async () => {
    await withCache({ tradeCurrency: 'USD', quoteCurrency: 'USD' }, async (client, fixture) => {
      expect((await readValuationReport(client, '1980-01-10'))[0]).toMatchObject({ status: 'valued', invested: '16.8', marketValue: '27', unrealizedGain: '10.2', fx: { observedOn: '1980-01-10', eurPerUsd: '0.9' } })
    })
  })

  it('flags missing quotes without fabricating values', async () => {
    await withCache({ noQuote: true }, async (client, fixture) => {
      const [row] = await readValuationReport(client, '1980-01-10')
      expect(row.status).toBe('quote-required')
      expect(row).not.toHaveProperty('marketValue')
    })
  })

  it('flags stale and future prices', async () => {
    for (const [quoteDate, status] of [['1980-01-02', 'quote-stale'], ['1980-01-11', 'quote-future']]) {
      await withCache({ quoteDate }, async (client, fixture) => {
        expect((await readValuationReport(client, '1980-01-10'))[0].status).toBe(status)
      })
    }
  })

  it('accepts a seven-day-old price', async () => {
    await withCache({ quoteDate: '1980-01-03' }, async (client, fixture) => {
      expect((await readValuationReport(client, '1980-01-10'))[0].status).toBe('valued')
    })
  })

  it('flags unavailable quote-date conversion', async () => {
    await withCache({ quoteCurrency: 'USD', currentMissing: true }, async (client, fixture) => {
      expect((await readValuationReport(client, '1980-01-10'))[0].status).toBe('current-fx-required')
    })
  })

  it('retains historical-fx-required without partial gain', async () => {
    await withCache({ tradeCurrency: 'USD', historicalMissing: true }, async (client, fixture) => {
      const [row] = await readValuationReport(client, '1980-01-10')
      expect(row.status).toBe('historical-fx-required')
      expect(row).not.toHaveProperty('unrealizedGain')
    })
  })

  it('closed positions need no quote', async () => {
    await withCache({ closed: true, noQuote: true }, async (client, fixture) => {
      expect((await readValuationReport(client, '1980-01-10'))[0]).toMatchObject({ status: 'valued', quantity: '0', marketValue: '0', unrealizedGain: '0' })
    })
  })

  it('returns empty for an empty ledger', async () => {
    await withIsolatedDatabase(async (client) => {
      expect(await readValuationReport(client, '1980-01-10')).toEqual([])
    })
  })

  it('rejects invalid dates and dates before imported activity', async () => {
    await withIsolatedDatabase(async (client) => {
      await setup(client)
      for (const date of ['1980-02-30', 'not-a-date', '1980-01-01']) {
        await expect(readValuationReport(client, date)).rejects.toThrow()
      }
    })
  })
})
