import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import postgres from 'postgres'
import { readCachedQuotes } from './quote-cache'

const url = new URL(process.env.DATABASE_URL!)
url.pathname = '/portfolio_test'
const sql = postgres(url.toString())
afterAll(() => sql.end())

function seed(symbol: string, date = '1991-01-04', price = '120.5', rollback = false) {
  execFileSync(process.env.WORKER_PYTHON ?? '.venv/py314/bin/python', ['-c', `
import os
from unittest.mock import patch
import psycopg
from worker.quotes import refresh_quotes
quote = {'symbol': '${symbol}', 'observedOn': '${date}', 'price': '${price}', 'currency': 'USD', 'source': 'yfinance'}
with psycopg.connect(os.environ['TEST_DATABASE_URL']) as connection:
    try:
        with connection.transaction(), patch('worker.quotes.fetch_quote', return_value=quote):
            refresh_quotes(connection, ['${symbol}'])
            ${rollback ? "raise RuntimeError('force rollback')" : 'pass'}
    except RuntimeError:
        ${rollback ? 'pass' : 'raise'}
`], { env: { ...process.env, TEST_DATABASE_URL: url.toString() } })
}

describe('security quote cache', () => {
  it('reads Python-persisted quotes with currency and freshness metadata', async () => {
    seed('SYNTHETIC-QUOTE-READ')
    expect(await readCachedQuotes(sql, ['SYNTHETIC-QUOTE-READ', 'SYNTHETIC-ABSENT'])).toEqual([
      { symbol: 'SYNTHETIC-QUOTE-READ', status: 'available', observedOn: '1991-01-04', price: '120.5', currency: 'USD', source: 'yfinance', fetchedAt: expect.any(String) },
      { symbol: 'SYNTHETIC-ABSENT', status: 'missing' },
    ])
  })

  it('returns missing when the cache table is absent', async () => {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL search_path TO pg_temp`
      expect(await readCachedQuotes(transaction, ['SYNTHETIC'])).toEqual([{ symbol: 'SYNTHETIC', status: 'missing' }])
    })
  })

  it('returns an empty list for no requested symbols', async () => {
    expect(await readCachedQuotes(sql, [])).toEqual([])
  })

  it('does not replace a newer observation with an older one', async () => {
    seed('SYNTHETIC-QUOTE-ORDER', '1991-01-04', '120.5')
    seed('SYNTHETIC-QUOTE-ORDER', '1991-01-03', '100')
    expect((await readCachedQuotes(sql, ['SYNTHETIC-QUOTE-ORDER']))[0]).toMatchObject({ observedOn: '1991-01-04', price: '120.5' })
  })

  it('refreshes an observation on the same date', async () => {
    seed('SYNTHETIC-QUOTE-UPDATE', '1991-01-04', '120.5')
    seed('SYNTHETIC-QUOTE-UPDATE', '1991-01-04', '121')
    expect((await readCachedQuotes(sql, ['SYNTHETIC-QUOTE-UPDATE']))[0]).toMatchObject({ price: '121' })
  })

  it('preserves the previous quote after a database rollback', async () => {
    seed('SYNTHETIC-QUOTE-ROLLBACK')
    seed('SYNTHETIC-QUOTE-ROLLBACK', '1991-01-05', '80', true)
    expect((await readCachedQuotes(sql, ['SYNTHETIC-QUOTE-ROLLBACK']))[0]).toMatchObject({ observedOn: '1991-01-04', price: '120.5' })
  })
})
