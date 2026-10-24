import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { createAccount } from './ledger-entry'
import { positionsImport } from './positions-import'
import { withIsolatedDatabase } from './test-support/schema'

const secret = 'x'.repeat(32)
const now = Date.UTC(2026, 5, 15)
const cookie = `session=${signSession(secret, now, 60_000)}`
const csv = 'account,symbol,quantity,average_price,currency,date\nCSV broker,VWCE.DE,2.5,100.20,EUR,2026-01-02\nCSV broker,AAPL,1,120,USD,2026-01-02\n'
const req = (text = csv, action = 'preview', headers: Record<string, string> = { cookie, origin: 'http://localhost' }) => new Request('http://localhost/api/positions/import', { method: 'POST', headers, body: JSON.stringify({ csv: text, action }) })

describe('positions CSV import endpoint', () => {
  it('previews without writes, then imports all rows and skips a repeat', async () => {
    await withIsolatedDatabase(async (sql) => {
      await createAccount(sql, { name: 'CSV broker', currency: 'EUR' })
      const deps = { sql, secret, now }
      const preview = await positionsImport(req(), deps)
      expect(preview.status).toBe(200)
      expect(await preview.json()).toMatchObject({ rows: [{ symbol: 'VWCE.DE' }, { symbol: 'AAPL' }] })
      expect(await sql`SELECT * FROM transactions`).toHaveLength(0)
      const saved = await positionsImport(req(csv, 'import'), deps)
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual({ created: 2, skipped: 0 })
      expect(await (await positionsImport(req(csv, 'import'), deps)).json()).toEqual({ created: 0, skipped: 2 })
      expect(await sql`SELECT quantity::text AS quantity FROM transactions ORDER BY seq`).toMatchObject([{ quantity: '2.5' }, { quantity: '1' }])
    })
  })
  it('creates missing accounts and rolls back all rows on a database error', async () => {
    await withIsolatedDatabase(async (sql) => {
      await createAccount(sql, { name: 'Existing', currency: 'EUR' })
      await sql.unsafe("ALTER TABLE transactions ADD CONSTRAINT reject_aapl CHECK (symbol <> 'AAPL')")
      const text = csv.replaceAll('CSV broker', 'New broker').replace(',USD,', ',EUR,')
      const response = await positionsImport(req(text, 'import'), { sql, secret, now })
      expect(response.status).toBe(500)
      expect(await sql`SELECT * FROM transactions`).toHaveLength(0)
      expect(await sql`SELECT * FROM accounts WHERE name = 'New broker'`).toHaveLength(0)
    })
  })
  it('creates a new account when all its rows use one currency', async () => {
    await withIsolatedDatabase(async (sql) => {
      const response = await positionsImport(req(csv.replace(',USD,', ',EUR,'), 'import'), { sql, secret, now })
      expect(response.status).toBe(200)
      expect(await sql`SELECT name FROM accounts`).toMatchObject([{ name: 'CSV broker' }])
      expect(await sql`SELECT * FROM transactions`).toHaveLength(2)
    })
  })
  it('rejects ambiguous account names and mixed currencies for a new account', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      expect((await positionsImport(req(), deps)).status).toBe(400)
      await createAccount(sql, { name: 'CSV broker', currency: 'EUR' })
      await createAccount(sql, { name: 'CSV broker', currency: 'EUR' })
      expect((await positionsImport(req(), deps)).status).toBe(400)
    })
  })
  it.each([
    [{ origin: 'http://localhost' }, 401], [{ cookie }, 403], [{ cookie, origin: 'http://evil.test' }, 403],
  ])('enforces session and origin before parsing', async (headers, status) => {
    await withIsolatedDatabase(async (sql) => {
      expect((await positionsImport(req(csv, 'import', headers), { sql, secret, now })).status).toBe(status)
    })
  })
  it('bounds the request stream and skips duplicate rows within one file', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      expect((await positionsImport(req('x'.repeat(2_100_001)), deps)).status).toBe(413)
      const text = 'account,symbol,quantity,average_price,currency,date\nRepeat,AAPL,1.0,100,USD,2026-01-02\nRepeat,AAPL,1,100.00,USD,2026-01-02\n'
      expect(await (await positionsImport(req(text, 'import'), deps)).json()).toEqual({ created: 1, skipped: 1 })
    })
  })

  it('rejects bad rows, unsupported actions and malformed request bodies', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      expect((await positionsImport(req('invalid'), deps)).status).toBe(400)
      expect((await positionsImport(req(csv, 'replace'), deps)).status).toBe(400)
      const malformed = new Request('http://localhost/api/positions/import', { method: 'POST', headers: { cookie, origin: 'http://localhost' }, body: '{' })
      expect((await positionsImport(malformed, deps)).status).toBe(400)
    })
  })
})
