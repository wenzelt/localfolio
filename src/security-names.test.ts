import { describe, expect, it } from 'vitest'
import { withIsolatedDatabase } from './test-support/schema'
import { readSecurityNames } from './security-names'

describe('cached security names', () => {
  it('returns no names before the worker creates its cache', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await readSecurityNames(sql)).toEqual({})
    })
  })
  it('reads cached names by original symbol without calling a provider', async () => {
    await withIsolatedDatabase(async (sql) => {
      await sql`CREATE TABLE security_names (symbol text PRIMARY KEY, name text)`
      await sql`INSERT INTO security_names VALUES ('SYNTHETIC', 'Synthetic World Fund')`
      expect(await readSecurityNames(sql)).toEqual({ SYNTHETIC: 'Synthetic World Fund' })
    })
  })
})
