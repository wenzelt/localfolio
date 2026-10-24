import { describe, expect, it } from 'vitest'
import { withIsolatedDatabase } from './test-support/schema'
import { readCountryCompositions } from './country-cache'

describe('cached country compositions', () => {
  it('returns no data before the worker has populated its cache', async () => {
    await withIsolatedDatabase(async (sql) => expect(await readCountryCompositions(sql)).toEqual({}))
  })
  it('reads country weights and source dates without external requests', async () => {
    await withIsolatedDatabase(async (sql) => {
      await sql`CREATE TABLE security_countries (symbol text PRIMARY KEY, weights jsonb, source text, as_of date, fetched_at timestamptz)`
      await sql`INSERT INTO security_countries VALUES ('FUND', '{"Germany":"25"}', 'https://example.org/fund', '2026-09-30', '2026-10-20T14:30:00+02:00')`
      await sql`INSERT INTO security_countries VALUES ('UNDATED', '{}', 'https://example.org/undated', null, null)`
      expect(await readCountryCompositions(sql)).toEqual({
        FUND: { weights: { Germany: '25' }, source: 'https://example.org/fund', asOf: '2026-09-30', fetchedAt: '2026-10-20T12:30:00.000Z' },
        UNDATED: { weights: {}, source: 'https://example.org/undated', asOf: null, fetchedAt: null },
      })
    })
  })
})
