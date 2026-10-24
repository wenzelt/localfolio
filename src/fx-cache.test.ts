import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import postgres from 'postgres'
import { readCachedRates, readCachedPositionReport, readRateHistory } from './fx-cache'
import { importGhostfolioExport, readLedger } from './ledger-store'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'

const url = new URL(process.env.DATABASE_URL!)
url.pathname = '/portfolio_test'
const sql = postgres(url.toString())
afterAll(() => sql.end())

function seed(rollback = false) {
  execFileSync(process.env.WORKER_PYTHON ?? '.venv/py314/bin/python', ['-c', `
import os
from datetime import datetime
from unittest.mock import Mock
import psycopg
from worker.fx import refresh_rates
class History:
    def iterrows(self):
        return iter([(datetime(1991, 1, 4), {'Close': ${rollback ? '0.7' : '0.9'}})])
factory = Mock()
factory.return_value.history.return_value = History()
with psycopg.connect(os.environ['TEST_DATABASE_URL']) as connection:
    try:
        with connection.transaction():
            refresh_rates(connection, '1991-01-04', '1991-01-04', factory)
            ${rollback ? "raise RuntimeError('force rollback')" : 'pass'}
    except RuntimeError:
        ${rollback ? 'pass' : 'raise'}
`], { env: { ...process.env, TEST_DATABASE_URL: url.toString() } })
}

describe('historical FX cache', () => {
  it('reads Python-persisted observations with bounded prior-date lookup and provenance', async () => {
    seed()
    expect(await readCachedRates(sql, ['1991-01-03', '1991-01-04', '1991-01-06', '1991-01-11', '1991-01-12'])).toEqual([
      { date: '1991-01-03', status: 'missing' },
      ...['1991-01-04', '1991-01-06', '1991-01-11'].map((date) => ({ date, status: 'available', observedOn: '1991-01-04', eurPerUsd: '0.9', source: 'USDEUR=X' })),
      { date: '1991-01-12', status: 'missing' },
    ])
  })

  it('treats an uninitialized cache as missing', async () => {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL search_path TO pg_temp`
      expect(await readCachedRates(transaction as unknown as typeof sql, ['1991-01-04'])).toEqual([
        { date: '1991-01-04', status: 'missing' },
      ])
    })
  })

  it('returns empty lookups and unknown reports', async () => {
    expect(await readCachedRates(sql, [])).toEqual([])
    await withIsolatedDatabase(async (client) => {
      expect(await readCachedPositionReport(client)).toEqual([])
    })
  })

  it('reports saved positions using cached historical rates', async () => {
    await withIsolatedDatabase(async (client) => {
      await client.unsafe(cacheTables)
      await client`INSERT INTO fx_observations VALUES ('1991-01-04', 0.9, 'USDEUR=X')`
      const id = crypto.randomUUID()
      await importGhostfolioExport(client, JSON.stringify({
        meta: { version: '0.0.1', date: '1991-01-06T00:00:00.000Z' },
        accounts: [{ id, name: 'Synthetic', currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded: false, platformId: null }],
        assetProfiles: [], platforms: [], tags: [],
        activities: [{ accountId: id, type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO', currency: 'USD', quantity: 2, unitPrice: 10, fee: 2, date: '1991-01-06T00:00:00.000Z', comment: null, tags: [] }],
        user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
      }))
      const [account] = (await readLedger(client)).accounts
      expect(await readCachedPositionReport(client)).toEqual([
        { accountId: account.id, accountName: 'Synthetic', isExcluded: false, symbol: 'EXAMPLE', status: 'calculated', currency: 'EUR', quantity: '2', invested: '19.8', averageCost: '9.9', realizedGain: '0', nativeInvested: '22' },
      ])
    })
  })

  it('flags an uncached USD position without partial calculation', async () => {
    await withIsolatedDatabase(async (client) => {
      const id = crypto.randomUUID()
      await importGhostfolioExport(client, JSON.stringify({
        meta: { version: '0.0.1', date: '1980-01-01T00:00:00.000Z' },
        accounts: [{ id, name: 'Synthetic', currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded: false, platformId: null }],
        assetProfiles: [], platforms: [], tags: [],
        activities: [{ accountId: id, type: 'BUY', symbol: 'MISSING', dataSource: 'YAHOO', currency: 'USD', quantity: 1, unitPrice: 10, fee: 0, date: '1980-01-01T00:00:00.000Z', comment: null, tags: [] }],
        user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
      }))
      const before = await readLedger(client)
      expect(await readCachedPositionReport(client)).toEqual([
        { accountId: before.accounts[0].id, accountName: 'Synthetic', isExcluded: false, symbol: 'MISSING', status: 'historical-fx-required' },
      ])
      expect(await readLedger(client)).toEqual(before)
    })
  })

  it('retains cached data when a transaction rolls back', async () => {
    seed()
    seed(true)
    expect((await readCachedRates(sql, ['1991-01-04']))[0]).toMatchObject({ eurPerUsd: '0.9' })
  })
})

describe('FX rate history', () => {
  it('reads every cached rate up to and including the date, oldest first', async () => {
    await sql.begin(async (transaction) => {
      await transaction`CREATE TEMP TABLE fx_observations (observed_on date, eur_per_usd numeric, source text) ON COMMIT DROP`
      await transaction`INSERT INTO fx_observations VALUES ('1980-01-04', 0.95, 'USDEUR=X'), ('1980-01-02', 0.9, 'USDEUR=X'), ('1980-01-05', 0.5, 'USDEUR=X')`
      expect(await readRateHistory(transaction, '1980-01-04')).toEqual([
        { date: '1980-01-02', eurPerUsd: '0.9' },
        { date: '1980-01-04', eurPerUsd: '0.95' },
      ])
    })
  })

  it('returns no rates when the cache table is absent', async () => {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL search_path TO pg_temp`
      expect(await readRateHistory(transaction, '1980-01-04')).toEqual([])
    })
  })
})
