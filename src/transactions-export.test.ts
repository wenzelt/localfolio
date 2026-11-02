import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { addTransaction, createAccount } from './ledger-entry'
import { transactionsHeader } from './transactions-csv'
import { transactionsExport } from './transactions-export'
import { withIsolatedDatabase } from './test-support/schema'

const secret = 's'.repeat(32)
const now = Date.UTC(2026, 2, 2, 8, 30)
const cookie = `session=${signSession(secret, now, 60_000)}`
const request = (headers: Record<string, string> = { cookie }) => new Request('http://localhost/api/transactions/export', { headers })
const bom = '﻿'

describe('exporting transactions', () => {
  it('downloads every transaction as a CSV file named after the day', async () => {
    await withIsolatedDatabase(async (sql) => {
      const broker = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      const savings = await createAccount(sql, { name: 'Savings', currency: 'USD' })
      await addTransaction(sql, { accountId: broker.id, type: 'BUY', symbol: 'VWCE.DE', currency: 'EUR', date: '2026-01-02', quantity: '12.5', unitPrice: '100.25', fee: '1.5', comment: 'first lot' })
      await addTransaction(sql, { accountId: savings.id, type: 'DEPOSIT', currency: 'USD', date: '2026-01-01', amount: '500' })
      await addTransaction(sql, { accountId: broker.id, type: 'SELL', symbol: 'VWCE.DE', currency: 'EUR', date: '2026-02-03', quantity: '2.5', unitPrice: '110' })
      const [tag] = await sql`INSERT INTO tags (name) VALUES ('core') RETURNING id`
      await sql`INSERT INTO transaction_tags SELECT id, ${tag.id} FROM transactions WHERE comment = 'first lot'`

      const response = await transactionsExport(request(), { sql, secret, now })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="localfolio-transactions-2026-03-02.csv"')
      expect(response.headers.get('cache-control')).toBe('no-store')
      // Oldest first, whichever order they were entered in.
      expect(await response.text()).toBe([
        `${bom}${transactionsHeader}`,
        '2026-01-01T00:00:00.000Z,Savings,DEPOSIT,,1,500,0,USD,,',
        '2026-01-02T00:00:00.000Z,Broker,BUY,VWCE.DE,12.5,100.25,1.5,EUR,first lot,core',
        '2026-02-03T00:00:00.000Z,Broker,SELL,VWCE.DE,2.5,110,0,EUR,,',
        '',
      ].join('\r\n'))
    })
  })

  it('exports transactions of excluded accounts too, since it is a record of the ledger', async () => {
    await withIsolatedDatabase(async (sql) => {
      const hidden = await createAccount(sql, { name: 'Hidden', currency: 'EUR' })
      await sql`UPDATE accounts SET is_excluded = true WHERE id = ${hidden.id}`
      await addTransaction(sql, { accountId: hidden.id, type: 'BUY', symbol: 'HIDDEN', currency: 'EUR', date: '2026-01-02', quantity: '1', unitPrice: '10' })
      expect(await (await transactionsExport(request(), { sql, secret, now })).text()).toContain(',Hidden,BUY,HIDDEN,')
    })
  })

  it('answers with just the header on an empty database, and does not create the ledger', async () => {
    await withIsolatedDatabase(async (sql) => {
      const response = await transactionsExport(request(), { sql, secret, now })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(`${bom}${transactionsHeader}\r\n`)
      const [{ name }] = await sql`SELECT to_regclass('accounts') AS name`
      expect(name).toBeNull()
    })
  })

  it('changes nothing when it reads', async () => {
    await withIsolatedDatabase(async (sql) => {
      const account = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      await addTransaction(sql, { accountId: account.id, type: 'BUY', symbol: 'A', currency: 'EUR', date: '2026-01-02', quantity: '1', unitPrice: '10' })
      await transactionsExport(request(), { sql, secret, now })
      await transactionsExport(request(), { sql, secret, now })
      expect(await sql`SELECT id FROM transactions`).toHaveLength(1)
    })
  })

  it.each([
    ['no cookie', {}],
    ['a forged cookie', { cookie: 'session=forged' }],
    ['an expired cookie', { cookie: `session=${signSession(secret, now - 120_000, 60_000)}` }],
  ])('refuses %s without sending any data', async (_name, headers) => {
    await withIsolatedDatabase(async (sql) => {
      const account = await createAccount(sql, { name: 'Private account', currency: 'EUR' })
      await addTransaction(sql, { accountId: account.id, type: 'BUY', symbol: 'PRIVATE', currency: 'EUR', date: '2026-01-02', quantity: '1', unitPrice: '10' })
      const response = await transactionsExport(request(headers), { sql, secret, now })
      expect(response.status).toBe(401)
      expect(response.headers.get('content-type')).not.toContain('text/csv')
      expect(response.headers.get('content-disposition')).toBeNull()
      expect(await response.text()).not.toMatch(/PRIVATE|Private account/)
    })
  })

  it('reports a database failure without leaking details', async () => {
    const unreachable = postgres('postgres://nobody:secret-password@127.0.0.1:1/missing', { connect_timeout: 2 })
    try {
      const response = await transactionsExport(request(), { sql: unreachable, secret, now })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'The transactions could not be exported' })
    } finally {
      await unreachable.end({ timeout: 1 })
    }
  })
})
