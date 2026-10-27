import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { ghostfolioImport } from './ghostfolio-import'
import { withIsolatedDatabase } from './test-support/schema'

const secret = 'x'.repeat(32)
const now = Date.UTC(2026, 5, 15)
const cookie = `session=${signSession(secret, now, 60_000)}`
const sample = readFileSync(new URL('../docs/examples/ghostfolio-export.sample.json', import.meta.url), 'utf8')
const req = (json = sample, headers: Record<string, string> = { cookie, origin: 'http://localhost' }) =>
  new Request('http://localhost/api/ghostfolio/import', { method: 'POST', headers, body: JSON.stringify({ json }) })
const counts = async (sql: Parameters<Parameters<typeof withIsolatedDatabase>[0]>[0]) => ({
  accounts: (await sql`SELECT count(*)::int AS n FROM accounts`)[0].n,
  transactions: (await sql`SELECT count(*)::int AS n FROM transactions`)[0].n,
})

describe('Ghostfolio export upload endpoint', () => {
  it('imports the export and reports created counts, then only skipped counts on a repeat', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      const first = await ghostfolioImport(req(), deps)
      expect(first.status).toBe(200)
      const { created, skipped } = await first.json()
      expect(created).toMatchObject({ accounts: 1, activities: expect.any(Number) })
      expect(created.activities).toBeGreaterThan(0)
      expect(skipped).toMatchObject({ accounts: 0, activities: 0 })
      const stored = await counts(sql)
      const again = await (await ghostfolioImport(req(), deps)).json()
      expect(again.created).toMatchObject({ accounts: 0, activities: 0 })
      expect(again.skipped).toMatchObject({ accounts: 1, activities: created.activities })
      expect(await counts(sql)).toEqual(stored)
    })
  })

  it('rejects a malformed export with a clear error and saves nothing', async () => {
    await withIsolatedDatabase(async (sql) => {
      const bad = JSON.stringify({ ...JSON.parse(sample), meta: { version: '9.9.9', date: '2026-01-15T12:00:00.000Z' } })
      for (const text of [bad, 'not json']) {
        const response = await ghostfolioImport(req(text), { sql, secret, now })
        expect(response.status).toBe(400)
        expect((await response.json()).error).toMatch(/^Import rejected: /)
      }
      expect(await sql`SELECT to_regclass('accounts') AS name`).toMatchObject([{ name: null }])
    })
  })

  it('requires a signed-in owner and a same-origin request', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      expect((await ghostfolioImport(req(sample, { origin: 'http://localhost' }), deps)).status).toBe(401)
      expect((await ghostfolioImport(req(sample, { cookie, origin: 'http://evil.example' }), deps)).status).toBe(403)
      expect(await sql`SELECT to_regclass('accounts') AS name`).toMatchObject([{ name: null }])
    })
  })

  it('refuses a missing file or an oversized upload', async () => {
    await withIsolatedDatabase(async (sql) => {
      const deps = { sql, secret, now }
      const empty = new Request('http://localhost/api/ghostfolio/import', { method: 'POST', headers: { cookie, origin: 'http://localhost' }, body: JSON.stringify({}) })
      expect((await ghostfolioImport(empty, deps)).status).toBe(400)
      expect((await ghostfolioImport(req('x'.repeat(2_200_000)), deps)).status).toBe(413)
    })
  })
})
