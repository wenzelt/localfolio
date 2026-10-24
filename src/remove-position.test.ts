import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { addTransaction, createAccount } from './ledger-entry'
import { removePosition } from './remove-position'
import { withIsolatedDatabase, cacheTables } from './test-support/schema'

const secret = 's'.repeat(32)
const now = Date.now()
const cookie = `session=${signSession(secret, now, 60_000)}`
const request = (body: unknown, headers: Record<string, string> = { cookie, origin: 'http://localhost' }) => new Request('http://localhost/api/positions', { method: 'DELETE', headers, body: JSON.stringify(body) })

async function fixture(sql: Parameters<typeof createAccount>[0]) {
  const a = await createAccount(sql, { name: 'A', currency: 'EUR' })
  const b = await createAccount(sql, { name: 'B', currency: 'EUR' })
  for (const [accountId, symbol] of [[a.id, 'SAME'], [a.id, 'OTHER'], [b.id, 'SAME']]) {
    await addTransaction(sql, { accountId, symbol, type: 'BUY', currency: 'EUR', date: '2026-01-01', quantity: '2', unitPrice: '10' })
  }
  await addTransaction(sql, { accountId: a.id, symbol: 'SAME', type: 'SELL', currency: 'EUR', date: '2026-01-02', quantity: '1', unitPrice: '11' })
  await addTransaction(sql, { accountId: a.id, symbol: 'SAME', type: 'DIVIDEND', currency: 'EUR', date: '2026-01-03', amount: '1' })
  await addTransaction(sql, { accountId: a.id, type: 'DEPOSIT', currency: 'EUR', date: '2026-01-01', amount: '100' })
  return { a, b, body: { accountId: a.id, symbol: 'SAME', confirm: 'SAME' } }
}

describe('permanently removing a position', () => {
  it('removes all symbol history only in the selected account, including tags; leaves cash, other holdings and market caches', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { a, b, body } = await fixture(sql)
      await sql.unsafe(cacheTables)
      await sql`INSERT INTO security_quotes (symbol, price) VALUES ('SAME', 10)`
      const [tag] = await sql`INSERT INTO tags (name) VALUES ('test') RETURNING id`
      await sql`INSERT INTO transaction_tags SELECT id, ${tag.id} FROM transactions WHERE account_id = ${a.id} AND symbol = 'SAME'`
      const response = await removePosition(request(body), { sql, secret, now })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ deleted: 3 })
      expect(await sql`SELECT id FROM transactions WHERE account_id = ${a.id} AND symbol = 'SAME'`).toHaveLength(0)
      expect(await sql`SELECT id FROM transactions WHERE account_id = ${b.id}`).toHaveLength(1)
      expect(await sql`SELECT id FROM transactions WHERE account_id = ${a.id}`).toHaveLength(2)
      expect(await sql`SELECT * FROM transaction_tags`).toHaveLength(0)
      expect(await sql`SELECT * FROM security_quotes`).toHaveLength(1)
      expect(await sql`SELECT * FROM accounts`).toHaveLength(2)
    })
  })

  it.each([
    [{ origin: 'http://localhost' }, 401],
    [{ cookie, origin: 'http://evil.test' }, 403],
    [{ cookie }, 403],
  ])('refuses unauthorized requests without deleting', async (headers, status) => {
    await withIsolatedDatabase(async (sql) => {
      const { body } = await fixture(sql)
      expect((await removePosition(request(body, headers), { sql, secret, now })).status).toBe(status)
      expect(await sql`SELECT * FROM transactions`).toHaveLength(6)
    })
  })

  it.each([{}, { accountId: 'x' }, { symbol: '' }, { confirm: 'wrong' }])('rejects incomplete or unconfirmed input %j', async (patch) => {
    await withIsolatedDatabase(async (sql) => {
      const { body } = await fixture(sql)
      const payload = Object.keys(patch).length === 0 ? {} : { ...body, ...patch }
      expect((await removePosition(request(payload), { sql, secret, now })).status).toBe(400)
      expect(await sql`SELECT * FROM transactions`).toHaveLength(6)
    })
  })

  it('returns 404 for a missing position and rolls back database failures without leaking details', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { body } = await fixture(sql)
      expect((await removePosition(request({ ...body, symbol: 'MISSING', confirm: 'MISSING' }), { sql, secret, now })).status).toBe(404)
      await sql.unsafe("CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private database detail'; END $$")
      await sql.unsafe('CREATE TRIGGER reject_delete BEFORE DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION reject_delete()')
      const response = await removePosition(request(body), { sql, secret, now })
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('private database detail')
      expect(await sql`SELECT * FROM transactions`).toHaveLength(6)
    })
  })

  it('rejects malformed JSON', async () => {
    await withIsolatedDatabase(async (sql) => {
      const req = new Request('http://localhost/api/positions', { method: 'DELETE', headers: { cookie, origin: 'http://localhost' }, body: '{' })
      expect((await removePosition(req, { sql, secret, now })).status).toBe(400)
    })
  })
})
