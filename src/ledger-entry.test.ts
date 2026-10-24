import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { readLedger } from './ledger-store'
import { runLedgerCli } from './ledger-cli'
import { addTransaction, createAccount } from './ledger-entry'
import { cacheTables, isolatedDatabase, withIsolatedDatabase } from './test-support/schema'

const buy = { type: 'BUY', date: '2026-01-02T10:00:00.000Z', currency: 'USD', symbol: 'EXAMPLE', quantity: '2', unitPrice: '10', fee: '1' }

async function accountIn(sql: Sql, currency = 'EUR') {
  return (await createAccount(sql, { name: 'Synthetic broker', currency })).id
}

const ledgerExists = async (sql: Sql) => (await sql`SELECT to_regclass('accounts') AS name`)[0].name !== null

describe('manual accounts', () => {
  it('stores a trimmed name, the currency and a comment', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: '  Synthetic broker ', currency: 'USD', comment: 'Synthetic' })
      expect((await readLedger(sql)).accounts).toEqual([
        { id, externalId: null, name: 'Synthetic broker', currency: 'USD', balance: '0', comment: 'Synthetic', isExcluded: false, balances: [] },
      ])
    })
  })

  it.each([
    [{ name: '   ', currency: 'EUR' }, /Account name is required/],
    [{ name: 'Broker', currency: 'GBP' }, /Unsupported currency/],
  ])('rejects %j before anything is saved', async (input, message) => {
    await withIsolatedDatabase(async (sql) => {
      await expect(createAccount(sql, input)).rejects.toThrow(message)
      expect(await ledgerExists(sql)).toBe(false)
    })
  })
})

describe('manual transactions', () => {
  it('keeps exact decimals, ticker, timestamp, fee, comment and a currency different from the account', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql, 'EUR')
      const { id } = await addTransaction(sql, { ...buy, accountId, quantity: '0.1234567891', unitPrice: '81.1', fee: '1.25', comment: 'Synthetic' })
      expect((await readLedger(sql)).activities).toEqual([
        { id, accountId, type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO', currency: 'USD', quantity: '0.1234567891', unitPrice: '81.1', fee: '1.25', date: '2026-01-02T10:00:00.000Z', comment: 'Synthetic', tags: [] },
      ])
    })
  })

  it('defaults the fee to zero and stores dates as UTC', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-01-02', currency: 'EUR', symbol: 'EXAMPLE', quantity: '1', unitPrice: '5' })
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-01-03T12:00:00+02:00', currency: 'EUR', symbol: 'EXAMPLE', quantity: '1', unitPrice: '5' })
      expect((await readLedger(sql)).activities.map(({ date, fee }) => [date, fee])).toEqual([
        ['2026-01-02T00:00:00.000Z', '0'], ['2026-01-03T10:00:00.000Z', '0'],
      ])
    })
  })

  it.each(['DEPOSIT', 'WITHDRAWAL', 'FEE', 'DIVIDEND'])('records a %s as an amount without an instrument quantity', async (type) => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type, date: '2026-01-02', currency: 'EUR', amount: '12.34' })
      expect((await readLedger(sql)).activities[0]).toMatchObject({ type, symbol: null, quantity: '1', unitPrice: '12.34', fee: '0', currency: 'EUR' })
    })
  })

  it('lets a dividend name the instrument that paid it', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type: 'DIVIDEND', date: '2026-01-02', currency: 'USD', symbol: 'EXAMPLE', amount: '3' })
      expect((await readLedger(sql)).activities[0]).toMatchObject({ type: 'DIVIDEND', symbol: 'EXAMPLE' })
    })
  })

  it.each([
    [{ type: 'TRANSFER' }, /Unsupported type/],
    [{ currency: 'GBP' }, /Unsupported currency/],
    [{ quantity: '0' }, /Invalid quantity/],
    [{ quantity: '-1' }, /Invalid quantity/],
    [{ quantity: 'abc' }, /Invalid quantity/],
    [{ quantity: '1e3' }, /Invalid quantity/],
    [{ unitPrice: '-5' }, /Invalid unit price/],
    [{ fee: '-1' }, /Invalid fee/],
    [{ date: '2026-02-30' }, /Invalid date/],
    [{ date: 'yesterday' }, /Invalid date/],
    [{ date: '' }, /Invalid date/],
    [{ symbol: '  ' }, /Symbol is required/],
    [{ amount: '5' }, /Amount is only for cash movements/],
    [{ accountId: '00000000-0000-4000-8000-000000000000' }, /Account not found/],
  ])('rejects %j and saves nothing', async (change, message) => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await expect(addTransaction(sql, { ...buy, accountId, ...change })).rejects.toThrow(message)
      expect((await readLedger(sql)).activities).toEqual([])
    })
  })

  it.each([
    [{ amount: '0' }, /Invalid amount/],
    [{ amount: undefined }, /Invalid amount/],
    [{ amount: '-3' }, /Invalid amount/],
    [{ quantity: '2' }, /Quantity and unit price are only for trades/],
    [{ unitPrice: '2' }, /Quantity and unit price are only for trades/],
    [{ symbol: 'EXAMPLE' }, /A deposit has no symbol/],
  ])('rejects a deposit with %j', async (change, message) => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await expect(addTransaction(sql, { accountId, type: 'DEPOSIT', date: '2026-01-02', currency: 'EUR', amount: '5', ...change })).rejects.toThrow(message)
      expect((await readLedger(sql)).activities).toEqual([])
    })
  })

  it('rejects invalid input before the ledger tables exist', async () => {
    await withIsolatedDatabase(async (sql) => {
      await expect(addTransaction(sql, { ...buy, accountId: crypto.randomUUID(), quantity: '-1' })).rejects.toThrow(/Invalid quantity/)
      expect(await ledgerExists(sql)).toBe(false)
    })
  })
})

describe('selling', () => {
  const sell = (accountId: string, quantity: string, date = '2026-02-01T00:00:00.000Z') =>
    ({ ...buy, type: 'SELL', accountId, quantity, date })

  it('allows a partial sale and then a sale of the remainder', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { ...buy, accountId })
      await addTransaction(sql, sell(accountId, '0.5'))
      await addTransaction(sql, sell(accountId, '1.5', '2026-03-01'))
      expect((await readLedger(sql)).activities.map((activity) => activity.type)).toEqual(['BUY', 'SELL', 'SELL'])
    })
  })

  it('rejects selling more than is held and saves nothing', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { ...buy, accountId })
      await expect(addTransaction(sql, sell(accountId, '2.0000000001'))).rejects.toThrow(/Cannot sell more than is held/)
      expect((await readLedger(sql)).activities).toHaveLength(1)
    })
  })

  it('rejects a sale dated before the purchase', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { ...buy, accountId })
      await expect(addTransaction(sql, sell(accountId, '1', '2025-12-31'))).rejects.toThrow(/Cannot sell more than is held/)
    })
  })

  it('counts holdings per account', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      const other = await accountIn(sql)
      await addTransaction(sql, { ...buy, accountId })
      await expect(addTransaction(sql, sell(other, '1'))).rejects.toThrow(/Cannot sell more than is held/)
    })
  })

  it('rejects a backdated sale that would leave a later sale uncovered', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { ...buy, accountId })
      await addTransaction(sql, sell(accountId, '2', '2026-03-01'))
      await expect(addTransaction(sql, sell(accountId, '1', '2026-02-01'))).rejects.toThrow(/Cannot sell more than is held/)
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })
})

describe('ledger:add command', () => {
  it('creates an account and prints its id', async () => {
    await withIsolatedDatabase(async (sql) => {
      const output = await runLedgerCli(sql, ['account', '--name', 'Synthetic broker', '--currency', 'EUR', '--comment', 'Synthetic'])
      const [account] = (await readLedger(sql)).accounts
      expect(output).toBe(`account\t${account.id}\n`)
      expect(account).toMatchObject({ name: 'Synthetic broker', currency: 'EUR', comment: 'Synthetic' })
    })
  })

  it('records a trade and a cash movement and prints their ids', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      const trade = await runLedgerCli(sql, ['transaction', '--account', accountId, '--type', 'BUY', '--date', '2026-01-02', '--currency', 'USD',
        '--symbol', 'EXAMPLE', '--quantity', '0.5', '--unit-price', '80.25', '--fee', '1', '--comment', 'Synthetic'])
      const cash = await runLedgerCli(sql, ['transaction', '--account', accountId, '--type', 'DEPOSIT', '--date', '2026-01-02', '--currency', 'EUR', '--amount', '100'])
      const [first, second] = (await readLedger(sql)).activities
      expect([trade, cash]).toEqual([`transaction\t${first.id}\n`, `transaction\t${second.id}\n`])
      expect(first).toMatchObject({ quantity: '0.5', unitPrice: '80.25', fee: '1', symbol: 'EXAMPLE', comment: 'Synthetic' })
      expect(second).toMatchObject({ type: 'DEPOSIT', unitPrice: '100' })
    })
  })

  it('passes domain rejections through', async () => {
    await withIsolatedDatabase(async (sql) => {
      await expect(runLedgerCli(sql, ['account', '--name', 'Broker', '--currency', 'GBP'])).rejects.toThrow(/Unsupported currency/)
    })
  })

  it.each([
    [[]],
    [['holding']],
    [['account', '--name']],
    [['account', '--currency', 'EUR']],
    [['account', '--name', 'Broker', '--currency', 'EUR', '--bogus', 'x']],
    [['account', 'extra']],
    [['transaction', '--type', 'BUY']],
  ])('prints usage for %j without touching the database', async (args) => {
    const untouched = (() => { throw new Error('database used') }) as unknown as Sql
    await expect(runLedgerCli(untouched, args)).rejects.toThrow(/^Usage: ledger:add account|^Usage: ledger:add transaction/)
  })

  it('runs as a process and is exposed as an npm script', async () => {
    const { sql, url, drop } = await isolatedDatabase()
    try {
      const result = spawnSync('node_modules/.bin/tsx', ['src/cli/ledger.ts', 'account', '--name', 'Synthetic broker', '--currency', 'EUR'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } })
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/^account\t[0-9a-f-]{36}\n$/)
      expect((await readLedger(sql)).accounts).toHaveLength(1)
      const rejected = spawnSync('node_modules/.bin/tsx', ['src/cli/ledger.ts', 'account', '--name', 'Broker', '--currency', 'GBP'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } })
      expect(rejected.status).toBe(1)
      expect(rejected.stderr).toContain('Unsupported currency')
      const unconfigured = spawnSync('node_modules/.bin/tsx', ['src/cli/ledger.ts'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: undefined } })
      expect(unconfigured.status).toBe(1)
      expect(unconfigured.stderr).toContain('DATABASE_URL is required')
      expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['ledger:add']).toContain('src/cli/ledger.ts')
    } finally {
      await drop()
    }
  })
})

describe('duplicate guard', () => {
  const entry = { type: 'BUY', date: '2026-01-02', currency: 'EUR', symbol: 'EXAMPLE', quantity: '2', unitPrice: '10', fee: '1' }

  it('rejects an identical transaction and saves nothing', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, ...entry })
      await expect(addTransaction(sql, { accountId, ...entry })).rejects.toThrow(/Duplicate transaction.*--force/)
      expect((await readLedger(sql)).activities).toHaveLength(1)
    })
  })

  it('compares decimals by value, so 2.0 duplicates 2', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, ...entry })
      await expect(addTransaction(sql, { accountId, ...entry, quantity: '2.0' })).rejects.toThrow(/Duplicate transaction/)
    })
  })

  it.each([
    ['another quantity', { quantity: '3' }],
    ['another price', { unitPrice: '11' }],
    ['another fee', { fee: '0' }],
    ['another day', { date: '2026-01-03' }],
    ['another symbol', { symbol: 'OTHER' }],
    ['another currency', { currency: 'USD' }],
  ])('accepts a transaction with %s', async (_name, change) => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, ...entry })
      await addTransaction(sql, { accountId, ...entry, ...change })
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })

  it('accepts the same entry in another account', async () => {
    await withIsolatedDatabase(async (sql) => {
      await addTransaction(sql, { accountId: await accountIn(sql), ...entry })
      await addTransaction(sql, { accountId: await accountIn(sql), ...entry })
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })

  it('rejects an identical cash movement too', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      const deposit = { accountId, type: 'DEPOSIT', date: '2026-01-02', currency: 'EUR', amount: '100' }
      await addTransaction(sql, deposit)
      await expect(addTransaction(sql, deposit)).rejects.toThrow(/Duplicate transaction/)
    })
  })

  it('saves a repeat when forced', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, ...entry })
      await addTransaction(sql, { accountId, ...entry, force: true })
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })

  it('lets ledger:add pass --force through', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      const args = ['transaction', '--account', accountId, '--type', 'BUY', '--date', '2026-01-02', '--currency', 'EUR',
        '--symbol', 'EXAMPLE', '--quantity', '2', '--unit-price', '10']
      await runLedgerCli(sql, args)
      await expect(runLedgerCli(sql, args)).rejects.toThrow(/Duplicate transaction/)
      await runLedgerCli(sql, [...args, '--force'])
      expect((await readLedger(sql)).activities).toHaveLength(2)
    })
  })
})

describe('ledger:add accounts', () => {
  it('prints id, name, currency and comment of every account', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id: first } = await createAccount(sql, { name: 'Broker B', currency: 'USD', comment: 'Synthetic' })
      const { id: second } = await createAccount(sql, { name: 'Broker A', currency: 'EUR' })
      expect(await runLedgerCli(sql, ['accounts'])).toBe(`${second}\tBroker A\tEUR\t\n${first}\tBroker B\tUSD\tSynthetic\n`)
    })
  })

  it('prints nothing, and creates nothing, when there are no accounts yet', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await runLedgerCli(sql, ['accounts'])).toBe('')
      expect(await ledgerExists(sql)).toBe(false)
    })
  })

  it('rejects extra arguments with the usage text', async () => {
    await withIsolatedDatabase(async (sql) => {
      await expect(runLedgerCli(sql, ['accounts', '--bogus'])).rejects.toThrow(/Usage: ledger:add/)
    })
  })
})

describe('price hint after a purchase', () => {
  const buyArgs = (accountId: string, symbol = 'EXAMPLE') => ['transaction', '--account', accountId, '--type', 'BUY', '--date', '2026-01-02',
    '--currency', 'EUR', '--symbol', symbol, '--quantity', '1', '--unit-price', '5']

  async function warnings(sql: Sql, args: string[]) {
    const messages: string[] = []
    const output = await runLedgerCli(sql, args, (message) => messages.push(message))
    return { output, messages }
  }

  it('warns when the bought symbol has no cached price, without changing the output', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      const { output, messages } = await warnings(sql, buyArgs(accountId))
      expect(output).toMatch(/^transaction\t[0-9a-f-]{36}\n$/)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(/No price cached for EXAMPLE.*refresh/)
    })
  })

  it('stays quiet when the symbol has a cached quote', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await sql.unsafe(cacheTables)
      await sql`INSERT INTO security_quotes VALUES ('EXAMPLE', '2026-01-02', 5, 'EUR', 'yfinance', now())`
      expect((await warnings(sql, buyArgs(accountId))).messages).toEqual([])
    })
  })

  it('stays quiet when the symbol has cached price history', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await sql.unsafe(cacheTables)
      await sql`INSERT INTO security_prices VALUES ('EXAMPLE', '2026-01-02', 5, 'EUR', 'yfinance', now())`
      expect((await warnings(sql, buyArgs(accountId))).messages).toEqual([])
    })
  })

  it('warns when only another symbol is cached', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await sql.unsafe(cacheTables)
      await sql`INSERT INTO security_quotes VALUES ('OTHER', '2026-01-02', 5, 'EUR', 'yfinance', now())`
      expect((await warnings(sql, buyArgs(accountId))).messages).toHaveLength(1)
    })
  })

  it('warns for an increase of an existing position, since the symbol may still be unpriced', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-01-01', currency: 'EUR', symbol: 'EXAMPLE', quantity: '1', unitPrice: '5' })
      expect((await warnings(sql, buyArgs(accountId))).messages).toHaveLength(1)
    })
  })

  it('does not warn for sales, cash movements or accounts', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-01-01', currency: 'EUR', symbol: 'EXAMPLE', quantity: '2', unitPrice: '5' })
      const sell = ['transaction', '--account', accountId, '--type', 'SELL', '--date', '2026-01-03', '--currency', 'EUR', '--symbol', 'EXAMPLE', '--quantity', '1', '--unit-price', '6']
      const deposit = ['transaction', '--account', accountId, '--type', 'DEPOSIT', '--date', '2026-01-03', '--currency', 'EUR', '--amount', '10']
      const dividend = ['transaction', '--account', accountId, '--type', 'DIVIDEND', '--date', '2026-01-03', '--currency', 'EUR', '--symbol', 'EXAMPLE', '--amount', '1']
      const messages = [sell, deposit, dividend, ['accounts'], ['account', '--name', 'Second', '--currency', 'EUR']].flatMap((args) => {
        const collected: string[] = []
        return runLedgerCli(sql, args, (message) => collected.push(message)).then(() => collected)
      })
      expect((await Promise.all(messages)).flat()).toEqual([])
    })
  })

  it('does not warn about a rejected entry', async () => {
    await withIsolatedDatabase(async (sql) => {
      const accountId = await accountIn(sql)
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-01-02', currency: 'EUR', symbol: 'EXAMPLE', quantity: '1', unitPrice: '5' })
      const messages: string[] = []
      await expect(runLedgerCli(sql, buyArgs(accountId), (message) => messages.push(message))).rejects.toThrow(/Duplicate/)
      expect(messages).toEqual([])
    })
  })

  it('reaches stderr, not stdout, when run as a process', async () => {
    const { sql, url, drop } = await isolatedDatabase()
    try {
      const accountId = await accountIn(sql)
      const result = spawnSync('node_modules/.bin/tsx', ['src/cli/ledger.ts', ...buyArgs(accountId)], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } })
      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/^transaction\t[0-9a-f-]{36}\n$/)
      expect(result.stderr).toMatch(/No price cached for EXAMPLE/)
    } finally {
      await drop()
    }
  })
})
