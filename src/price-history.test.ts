import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import postgres from 'postgres'
import { readPriceHistory, readPricesFetchedAt } from './price-history'

const url = new URL(process.env.DATABASE_URL!)
url.pathname = '/portfolio_test'
const sql = postgres(url.toString())
afterAll(() => sql.end())

function seed() {
  execFileSync(process.env.WORKER_PYTHON ?? '.venv/py314/bin/python', ['-c', `
import os
from datetime import date
from unittest.mock import patch
import psycopg
from worker.prices import refresh_price_history
rows = [
    {'symbol': 'SYNTHETIC-HISTORY', 'observedOn': '1991-01-04', 'close': '120.50001', 'currency': 'USD'},
    {'symbol': 'SYNTHETIC-HISTORY', 'observedOn': '1991-01-07', 'close': '125', 'currency': 'USD'},
    {'symbol': 'SYNTHETIC-HISTORY', 'observedOn': '1991-01-08', 'close': '130', 'currency': 'USD'},
    {'symbol': 'SYNTHETIC-HISTORY-EUR', 'observedOn': '1991-01-04', 'close': '20', 'currency': 'EUR'},
]
with psycopg.connect(os.environ['TEST_DATABASE_URL']) as connection:
    with patch('worker.prices.fetch_price_history', return_value=rows):
        refresh_price_history(connection, ['SYNTHETIC-HISTORY'], date(1991, 1, 4), date(1991, 1, 8))
`], { env: { ...process.env, TEST_DATABASE_URL: url.toString() } })
}

describe('security price history', () => {
  it('reads Python-written history in date order, preserving exact decimals and currencies', async () => {
    seed()
    expect(await readPriceHistory(sql, ['SYNTHETIC-HISTORY', 'SYNTHETIC-HISTORY-EUR'], '1991-01-07')).toEqual([
      { symbol: 'SYNTHETIC-HISTORY', observedOn: '1991-01-04', close: '120.50001', currency: 'USD' },
      { symbol: 'SYNTHETIC-HISTORY', observedOn: '1991-01-07', close: '125', currency: 'USD' },
      { symbol: 'SYNTHETIC-HISTORY-EUR', observedOn: '1991-01-04', close: '20', currency: 'EUR' },
    ])
  })

  it('includes older rows needed to carry a close over non-trading days, but never future rows', async () => {
    seed()
    expect(await readPriceHistory(sql, ['SYNTHETIC-HISTORY'], '1991-01-06')).toEqual([
      { symbol: 'SYNTHETIC-HISTORY', observedOn: '1991-01-04', close: '120.50001', currency: 'USD' },
    ])
  })

  it('returns no rows for missing symbols or a date before the first close', async () => {
    seed()
    expect(await readPriceHistory(sql, ['SYNTHETIC-HISTORY-ABSENT'], '1991-01-07')).toEqual([])
    expect(await readPriceHistory(sql, ['SYNTHETIC-HISTORY'], '1991-01-03')).toEqual([])
  })

  it('returns no rows when no symbols are requested', async () => {
    expect(await readPriceHistory(sql, [], '1991-01-07')).toEqual([])
  })

  it('returns no rows when the cache table is absent', async () => {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL search_path TO pg_temp`
      expect(await readPriceHistory(transaction, ['SYNTHETIC-HISTORY'], '1991-01-07')).toEqual([])
    })
  })

  it('reports when the newest price was fetched, as an ISO timestamp', async () => {
    seed()
    const fetchedAt = await readPricesFetchedAt(sql, ['SYNTHETIC-HISTORY', 'SYNTHETIC-HISTORY-EUR'])
    expect(fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Date.now() - Date.parse(String(fetchedAt))).toBeLessThan(60_000)
  })

  it('reports no fetch time for missing symbols, no symbols or an absent table', async () => {
    seed()
    expect(await readPricesFetchedAt(sql, ['SYNTHETIC-HISTORY-ABSENT'])).toBeNull()
    expect(await readPricesFetchedAt(sql, [])).toBeNull()
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL search_path TO pg_temp`
      expect(await readPricesFetchedAt(transaction, ['SYNTHETIC-HISTORY'])).toBeNull()
    })
  })
})
