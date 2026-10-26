import { describe, expect, it } from 'vitest'
import { addAccount, deleteAccount, DuplicateAccountError, InvalidAccountError, listAccountSummaries } from './accounts'
import { addTransaction, createAccount } from './ledger-entry'
import { withIsolatedDatabase } from './test-support/schema'

const buy = (accountId: string, symbol: string, quantity = '1') =>
  ({ accountId, symbol, type: 'BUY', currency: 'EUR', date: '2026-01-01', quantity, unitPrice: '10' })

describe('listing accounts with their activity', () => {
  it('answers an empty database without creating the ledger', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await listAccountSummaries(sql)).toEqual([])
      const [{ name }] = await sql`SELECT to_regclass('accounts') AS name`
      expect(name).toBeNull()
    })
  })

  it('counts transactions and open positions per account, ordered by name', async () => {
    await withIsolatedDatabase(async (sql) => {
      const zed = await createAccount(sql, { name: 'Zed', currency: 'USD', comment: 'joint' })
      const alpha = await createAccount(sql, { name: 'Alpha', currency: 'EUR' })
      await createAccount(sql, { name: 'Empty', currency: 'EUR' })
      await addTransaction(sql, buy(alpha.id, 'OPEN'))
      await addTransaction(sql, buy(alpha.id, 'SOLD', '2'))
      await addTransaction(sql, { accountId: alpha.id, symbol: 'SOLD', type: 'SELL', currency: 'EUR', date: '2026-02-01', quantity: '2', unitPrice: '11' })
      await addTransaction(sql, { accountId: alpha.id, type: 'DEPOSIT', currency: 'EUR', date: '2026-01-01', amount: '100' })
      await addTransaction(sql, buy(zed.id, 'OPEN'))
      expect(await listAccountSummaries(sql)).toEqual([
        { id: alpha.id, name: 'Alpha', currency: 'EUR', comment: null, transactions: 4, positions: 1 },
        { id: expect.any(String), name: 'Empty', currency: 'EUR', comment: null, transactions: 0, positions: 0 },
        { id: zed.id, name: 'Zed', currency: 'USD', comment: 'joint', transactions: 1, positions: 1 },
      ])
    })
  })
})

describe('adding an account', () => {
  it('creates the ledger on first use and stores the trimmed name, currency and comment', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await addAccount(sql, { name: '  Broker  ', currency: 'USD', comment: 'long term' })
      expect(await listAccountSummaries(sql)).toEqual([{ id, name: 'Broker', currency: 'USD', comment: 'long term', transactions: 0, positions: 0 }])
    })
  })

  it('rejects an empty name and an unsupported currency', async () => {
    await withIsolatedDatabase(async (sql) => {
      await expect(addAccount(sql, { name: '   ', currency: 'EUR' })).rejects.toBeInstanceOf(InvalidAccountError)
      await expect(addAccount(sql, { name: 'X', currency: 'GBP' })).rejects.toThrow('Unsupported currency: GBP')
      expect(await listAccountSummaries(sql)).toEqual([])
    })
  })

  it('rejects an exact duplicate name, even with stray spaces, but allows a different case', async () => {
    await withIsolatedDatabase(async (sql) => {
      await addAccount(sql, { name: 'Broker', currency: 'EUR' })
      await expect(addAccount(sql, { name: ' Broker ', currency: 'USD' })).rejects.toBeInstanceOf(DuplicateAccountError)
      await addAccount(sql, { name: 'broker', currency: 'EUR' })
      expect((await listAccountSummaries(sql)).map((account) => account.name)).toEqual(['Broker', 'broker'])
    })
  })

  it('creates exactly one account when the same name is added concurrently', async () => {
    await withIsolatedDatabase(async (sql) => {
      await createAccount(sql, { name: 'Seed', currency: 'EUR' })
      const results = await Promise.allSettled([1, 2, 3, 4].map(() => addAccount(sql, { name: 'Race', currency: 'EUR' })))
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof DuplicateAccountError)).toHaveLength(3)
      expect((await listAccountSummaries(sql)).filter((account) => account.name === 'Race')).toHaveLength(1)
    })
  })
})

describe('deleting an account', () => {
  it('removes the account with its transactions, tags and balances and leaves other accounts alone', async () => {
    await withIsolatedDatabase(async (sql) => {
      const doomed = await createAccount(sql, { name: 'Doomed', currency: 'EUR' })
      const kept = await createAccount(sql, { name: 'Kept', currency: 'EUR' })
      await addTransaction(sql, buy(doomed.id, 'AAA'))
      await addTransaction(sql, buy(doomed.id, 'BBB'))
      await addTransaction(sql, buy(kept.id, 'AAA'))
      const [{ id: transactionId }] = await sql`SELECT id FROM transactions WHERE account_id = ${doomed.id} LIMIT 1`
      const [tag] = await sql`INSERT INTO tags (name) VALUES ('t') RETURNING id`
      await sql`INSERT INTO transaction_tags VALUES (${transactionId}, ${tag.id})`
      await sql`INSERT INTO account_balances VALUES (${doomed.id}, now(), 5)`

      expect(await deleteAccount(sql, doomed.id, 'Doomed')).toEqual({ status: 'deleted', transactions: 2 })
      expect(await listAccountSummaries(sql)).toEqual([{ id: kept.id, name: 'Kept', currency: 'EUR', comment: null, transactions: 1, positions: 1 }])
      expect(await sql`SELECT 1 FROM transaction_tags`).toHaveLength(0)
      expect(await sql`SELECT 1 FROM account_balances`).toHaveLength(0)
    })
  })

  it('deletes an account that has no transactions', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Empty', currency: 'EUR' })
      expect(await deleteAccount(sql, id, 'Empty')).toEqual({ status: 'deleted', transactions: 0 })
      expect(await listAccountSummaries(sql)).toEqual([])
    })
  })

  it('refuses a wrong confirmation and keeps everything', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Keep me', currency: 'EUR' })
      await addTransaction(sql, buy(id, 'AAA'))
      expect(await deleteAccount(sql, id, 'keep me')).toEqual({ status: 'mismatch' })
      expect(await deleteAccount(sql, id, '')).toEqual({ status: 'mismatch' })
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })

  it('reports an unknown account and an empty database as not found', async () => {
    await withIsolatedDatabase(async (sql) => {
      const missing = '00000000-0000-4000-8000-000000000000'
      expect(await deleteAccount(sql, missing, 'x')).toEqual({ status: 'not-found' })
      await createAccount(sql, { name: 'Other', currency: 'EUR' })
      expect(await deleteAccount(sql, missing, 'x')).toEqual({ status: 'not-found' })
      expect(await listAccountSummaries(sql)).toHaveLength(1)
    })
  })
})
