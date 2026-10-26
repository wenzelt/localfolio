import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { listAccountSummaries } from './accounts'
import { deleteAccountRequest, postAccountRequest } from './accounts-routes'
import { addTransaction, createAccount } from './ledger-entry'
import { withIsolatedDatabase } from './test-support/schema'

const secret = 's'.repeat(32)
const now = Date.now()
const cookie = `session=${signSession(secret, now, 60_000)}`
const signedIn = { cookie, origin: 'http://localhost' }
const make = (method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = signedIn) =>
  new Request('http://localhost/api/accounts', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /api/accounts', () => {
  it('requires a session and a same-origin request', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      expect((await postAccountRequest(make('POST', { name: 'A', currency: 'EUR' }, { origin: 'http://localhost' }), deps)).status).toBe(401)
      expect((await postAccountRequest(make('POST', { name: 'A', currency: 'EUR' }, { cookie, origin: 'http://evil.example' }), deps)).status).toBe(403)
      expect(await listAccountSummaries(sql)).toEqual([])
    })
  })

  it('creates an account and answers 201 with its id and no-store caching', async () => {
    await withIsolatedDatabase(async (sql) => {
      const response = await postAccountRequest(make('POST', { name: ' Broker ', currency: 'USD', comment: 'joint' }), { sql, secret, now })
      expect(response.status).toBe(201)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const { id } = await response.json()
      expect(await listAccountSummaries(sql)).toEqual([{ id, name: 'Broker', currency: 'USD', comment: 'joint', transactions: 0, positions: 0 }])
    })
  })

  it('rejects malformed, empty and mistyped input with 400 and creates nothing', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      for (const body of ['not json', 'null', { name: '  ', currency: 'EUR' }, { name: 'A', currency: 'GBP' }, { name: 5, currency: 'EUR' }, { name: 'A', currency: 'EUR', comment: 7 }]) {
        const response = await postAccountRequest(make('POST', body), deps)
        expect(response.status).toBe(400)
        expect(typeof (await response.json()).error).toBe('string')
      }
      expect(await listAccountSummaries(sql)).toEqual([])
    })
  })

  it('answers 409 for a name that already exists', async () => {
    await withIsolatedDatabase(async (sql) => {
      await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      const response = await postAccountRequest(make('POST', { name: 'Broker', currency: 'EUR' }), { sql, secret, now })
      expect(response.status).toBe(409)
      expect((await response.json()).error).toContain('already exists')
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })
})

describe('DELETE /api/accounts', () => {
  async function fixture(sql: Parameters<typeof createAccount>[0]) {
    const account = await createAccount(sql, { name: 'Doomed', currency: 'EUR' })
    await addTransaction(sql, { accountId: account.id, symbol: 'AAA', type: 'BUY', currency: 'EUR', date: '2026-01-01', quantity: '1', unitPrice: '10' })
    return account.id
  }

  it('requires a session and a same-origin request', async () => {
    await withIsolatedDatabase(async (sql) => {
      const id = await fixture(sql)
      const deps = { sql, secret, now }
      expect((await deleteAccountRequest(make('DELETE', { accountId: id, confirm: 'Doomed' }, { origin: 'http://localhost' }), deps)).status).toBe(401)
      expect((await deleteAccountRequest(make('DELETE', { accountId: id, confirm: 'Doomed' }, { cookie, origin: 'http://evil.example' }), deps)).status).toBe(403)
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })

  it('deletes the account and reports how many transactions went with it', async () => {
    await withIsolatedDatabase(async (sql) => {
      const id = await fixture(sql)
      const response = await deleteAccountRequest(make('DELETE', { accountId: id, confirm: 'Doomed' }), { sql, secret, now })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ deleted: 1 })
      expect(await listAccountSummaries(sql)).toEqual([])
    })
  })

  it('answers 400 for a malformed request, a bad id or a confirmation that is not the exact name', async () => {
    await withIsolatedDatabase(async (sql) => {
      const id = await fixture(sql)
      const deps = { sql, secret, now }
      for (const body of ['not json', 'null', { accountId: 'nope', confirm: 'Doomed' }, { accountId: id }, { accountId: id, confirm: 'doomed' }, { accountId: id, confirm: '' }]) {
        expect((await deleteAccountRequest(make('DELETE', body), deps)).status).toBe(400)
      }
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })

  it('answers 404 for an account that does not exist', async () => {
    await withIsolatedDatabase(async (sql) => {
      await fixture(sql)
      const response = await deleteAccountRequest(make('DELETE', { accountId: '00000000-0000-4000-8000-000000000000', confirm: 'Doomed' }), { sql, secret, now })
      expect(response.status).toBe(404)
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })
})
