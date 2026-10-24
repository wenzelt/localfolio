import { describe, expect, it } from 'vitest'
import { withIsolatedDatabase } from './test-support/schema'
import { consolidateAccounts } from './account-consolidation'

async function setup(sql: Parameters<typeof consolidateAccounts>[0]) {
  await sql`CREATE TABLE accounts (id text PRIMARY KEY, currency text, is_excluded boolean, balance numeric)`
  await sql`CREATE TABLE account_balances (account_id text REFERENCES accounts(id), recorded_at timestamptz, value numeric)`
  await sql`CREATE TABLE transactions (id text PRIMARY KEY, account_id text REFERENCES accounts(id), quantity numeric, unit_price numeric, fee numeric, occurred_at timestamptz, external_key text UNIQUE)`
  await sql`CREATE TABLE transaction_tags (transaction_id text REFERENCES transactions(id), tag_id text)`
  await sql`INSERT INTO accounts VALUES ('individual', 'USD', false, 10), ('joint', 'USD', false, 20), ('other', 'EUR', false, 30)`
  await sql`INSERT INTO account_balances VALUES ('individual', '2020-01-01', 10), ('joint', '2020-01-01', 20), ('other', '2020-01-01', 30)`
  await sql`INSERT INTO transactions VALUES ('old', 'individual', 1.25, 80, 2, '2020-01-01', 'import-original'), ('existing', 'joint', 2, 90, 1, '2021-01-01', 'import-joint')`
  await sql`INSERT INTO transaction_tags VALUES ('old', 'keep-tag')`
}

describe('historical account consolidation and cash cleanup', () => {
  it('moves history without changing trade fields or tags and clears all cash balances', async () => {
    await withIsolatedDatabase(async (sql) => {
      await setup(sql)
      const before = await sql`SELECT id, quantity, unit_price, fee, occurred_at, external_key FROM transactions ORDER BY id`
      expect(await consolidateAccounts(sql, 'individual', 'joint')).toEqual({ moved: 1 })
      expect(await sql`SELECT id, quantity, unit_price, fee, occurred_at, external_key FROM transactions ORDER BY id`).toEqual(before)
      expect(await sql`SELECT account_id FROM transactions`).toEqual([{ account_id: 'joint' }, { account_id: 'joint' }])
      expect(await sql`SELECT * FROM transaction_tags`).toEqual([{ transaction_id: 'old', tag_id: 'keep-tag' }])
      expect(await sql`SELECT * FROM account_balances`).toEqual([])
      expect(await sql`SELECT id FROM accounts WHERE balance <> 0 OR id = 'individual'`).toEqual([])
      expect(await consolidateAccounts(sql, 'individual', 'joint')).toEqual({ moved: 0 })
    })
  })
  it('rejects missing targets, same-account merges and incompatible accounts without clearing cash', async () => {
    await withIsolatedDatabase(async (sql) => {
      await setup(sql)
      await expect(consolidateAccounts(sql, 'individual', 'absent')).rejects.toThrow('Target account not found')
      await expect(consolidateAccounts(sql, 'joint', 'joint')).rejects.toThrow('Accounts must differ')
      await expect(consolidateAccounts(sql, 'individual', 'other')).rejects.toThrow('Account settings differ')
      expect((await sql`SELECT * FROM account_balances`)).toHaveLength(3)
      expect((await sql`SELECT * FROM accounts WHERE balance <> 0`)).toHaveLength(3)
    })
  })
})
