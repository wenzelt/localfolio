import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { importGhostfolioExport } from './ledger-store'
import { readPerformanceReport } from './performance-report'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'

type Options = { currency?: 'EUR' | 'USD'; withExcluded?: boolean; sameSymbol?: boolean }
async function setup(sql: Sql, options: Options = {}) {
  const symbol = `SYNTHETIC-${crypto.randomUUID()}`
  const other = `SYNTHETIC-${crypto.randomUUID()}`
  const account = (name: string, isExcluded: boolean) =>
    ({ id: crypto.randomUUID(), name, currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded, platformId: null })
  const accounts = [account('Synthetic included', false), account('Synthetic excluded', !options.sameSymbol)]
  const trade = (accountId: string, name: string, quantity: number, unitPrice: number, currency: string) =>
    ({ accountId, type: 'BUY', symbol: name, dataSource: 'YAHOO', currency, quantity, unitPrice, fee: 0, date: '1980-01-02T10:00:00.000Z', comment: null, tags: [] })
  const document = {
    meta: { version: '0.0.1', date: '1980-01-02T12:00:00.000Z' },
    accounts,
    activities: [
      trade(accounts[0].id, symbol, 10, 10, options.currency ?? 'EUR'),
      ...(options.withExcluded ? [trade(accounts[1].id, other, 100, 1, 'EUR')] : []),
      ...(options.sameSymbol ? [trade(accounts[1].id, symbol, 100, 10, 'EUR')] : []),
    ],
    assetProfiles: [], platforms: [], tags: [],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }
  await importGhostfolioExport(sql, JSON.stringify(document))
  const [{ id: accountId }] = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE external_id = ${accounts[0].id}`
  const [{ id: excludedId }] = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE external_id = ${accounts[1].id}`
  return { symbol, other, accountId, excludedId }
}

async function withCache(
  options: Options,
  check: (client: Sql, fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  priceCurrency = 'EUR',
) {
  await withIsolatedDatabase(async (client) => {
    const fixture = await setup(client, options)
    await client.unsafe(cacheTables)
    for (const [date, close] of [['1980-01-02', 10], ['1980-01-03', 11], ['1980-01-04', 12]] as const) {
      await client`INSERT INTO security_prices VALUES (${fixture.symbol}, ${date}, ${close}, ${priceCurrency}, 'yfinance', now())`
      await client`INSERT INTO security_prices VALUES (${fixture.other}, ${date}, 5, 'EUR', 'yfinance', now())`
    }
    await client`INSERT INTO fx_observations VALUES ('1980-01-02', 0.9, 'USDEUR=X'), ('1980-01-04', 0.95, 'USDEUR=X')`
    await check(client, fixture)
  })
}

describe('performance report from the database', () => {
  it('scopes performance to a single account and symbol', async () => {
    await withCache({ withExcluded: true }, async (client, { symbol, accountId }) => {
      const report = await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId, symbol })
      expect(report).toMatchObject({ value: '120', change: '20', changePercent: '20' })
    })
  })

  it('keeps the same symbol in two accounts separate', async () => {
    await withCache({ sameSymbol: true }, async (client, { symbol, accountId, excludedId }) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId, symbol })).toMatchObject({ value: '120' })
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId: excludedId, symbol })).toMatchObject({ value: '1200' })
    })
  })

  it('attaches the cached close, currency and close date to each day of a scoped series', async () => {
    await withCache({ withExcluded: true }, async (client, { symbol, accountId }) => {
      const report = await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId, symbol })
      expect(report?.series.map((day) => 'price' in day && day.price)).toEqual([
        { close: '10', currency: 'EUR', date: '1980-01-02' },
        { close: '11', currency: 'EUR', date: '1980-01-03' },
        { close: '12', currency: 'EUR', date: '1980-01-04' },
      ])
    })
  })

  it('labels a USD close with its own currency, not EUR', async () => {
    await withCache({ currency: 'USD' }, async (client, { symbol, accountId }) => {
      const report = await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId, symbol })
      expect(report?.series.map((day) => 'price' in day && day.price && day.price.currency)).toEqual(['USD', 'USD', 'USD'])
    }, 'USD')
  })

  it('leaves the portfolio series without prices', async () => {
    await withCache({}, async (client) => {
      const report = await readPerformanceReport(client, '1980-01-04', 'MAX')
      expect(report?.series.some((day) => 'price' in day)).toBe(false)
    })
  })

  it('returns null for an unknown symbol or account without exposing portfolio totals', async () => {
    await withCache({}, async (client, { symbol, accountId }) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId, symbol: 'UNKNOWN' })).toBeNull()
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId: crypto.randomUUID(), symbol })).toBeNull()
    })
  })

  it('does not expose excluded holdings through scoped performance', async () => {
    await withCache({ withExcluded: true }, async (client, { other, excludedId }) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX', { accountId: excludedId, symbol: other })).toBeNull()
    })
  })

  it('computes performance for the ledger from cached prices', async () => {
    await withCache({}, async (client) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toMatchObject({
        period: 'MAX', from: '1980-01-02', to: '1980-01-04', value: '120', change: '20', changePercent: '20', unpriced: [],
      })
    })
  })

  it('reports price freshness, and FX freshness only when a USD holding exists', async () => {
    await withCache({}, async (client) => {
      expect((await readPerformanceReport(client, '1980-01-04', 'MAX'))?.freshness)
        .toEqual({ pricesThrough: '1980-01-04', ratesThrough: null, stale: [], fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    })
    await withCache({ currency: 'USD' }, async (client) => {
      expect((await readPerformanceReport(client, '1980-01-04', 'MAX'))?.freshness)
        .toEqual({ pricesThrough: '1980-01-04', ratesThrough: '1980-01-04', stale: [], fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    }, 'USD')
  })

  it('flags prices and FX as stale when the cache is older than seven days', async () => {
    await withCache({ currency: 'USD' }, async (client) => {
      expect((await readPerformanceReport(client, '1980-01-20', 'MAX'))?.freshness)
        .toEqual({ pricesThrough: '1980-01-04', ratesThrough: '1980-01-04', stale: ['prices', 'fx'], fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    }, 'USD')
  })

  it('leaves out accounts that Ghostfolio excludes from the portfolio', async () => {
    await withCache({ withExcluded: true }, async (client) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toMatchObject({ value: '120', unpriced: [] })
    })
  })

  it('converts USD holdings with the cached FX rates', async () => {
    await withCache({ currency: 'USD' }, async (client) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toMatchObject({ value: '114', change: '24' })
    }, 'USD')
  })

  it('lists symbols without cached prices as unpriced', async () => {
    await withCache({}, async (client, fixture) => {
      await client`DELETE FROM security_prices WHERE symbol = ${fixture.symbol}`
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toMatchObject({ from: null, value: '0', unpriced: [fixture.symbol] })
    })
  })

  it('ignores cash movements, which have no price', async () => {
    await withCache({}, async (client) => {
      const [account] = await client`SELECT id FROM accounts LIMIT 1`
      await client`INSERT INTO transactions (account_id, type, currency, quantity, unit_price, fee, occurred_at)
        VALUES (${account.id}, 'DEPOSIT', 'EUR', 1, 500, 0, '1980-01-02T09:00:00Z')`
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toMatchObject({ value: '120', unpriced: [] })
    })
  })

  it('returns null when nothing has been imported or entered', async () => {
    await withIsolatedDatabase(async (client) => {
      expect(await readPerformanceReport(client, '1980-01-04', 'MAX')).toBeNull()
    })
  })

  it('rejects an invalid date or period before reading', async () => {
    await withIsolatedDatabase(async (client) => {
      await expect(readPerformanceReport(client, '1980-02-30', 'MAX')).rejects.toThrow('Invalid performance date')
      await expect(readPerformanceReport(client, '1980-01-03', 'ALL' as never)).rejects.toThrow('Unsupported period')
    })
  })
})
