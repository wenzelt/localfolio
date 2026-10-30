import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { createMcpServer } from './mcp'
import { createAccount } from './ledger-entry'
import { readLedger } from './ledger-store'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'
import { openReadOnly } from './valuation-cli'

async function connected<T>(sql: Sql, writes: boolean, run: (client: Client) => Promise<T>) {
  const server = createMcpServer(sql, writes)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try { return await run(client) } finally { await client.close(); await server.close() }
}

const buy = { type: 'BUY', date: '1980-01-02', currency: 'EUR', symbol: 'SYNTHETIC', quantity: '2.5', unitPrice: '10.1', fee: '0.2' }

function data(response: Awaited<ReturnType<Client['callTool']>>) {
  expect(response.isError).not.toBe(true)
  return response.structuredContent as Record<string, unknown>
}

describe('MCP portfolio tools', () => {
  it('exposes only read tools by default and handles an empty ledger', async () => {
    await withIsolatedDatabase((sql) => connected(sql, false, async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['list_accounts', 'list_activities', 'get_valuation'])
      expect(data(await client.callTool({ name: 'list_accounts', arguments: {} }))).toEqual({ accounts: [] })
      expect(data(await client.callTool({ name: 'list_activities', arguments: {} }))).toEqual({ activities: [], nextOffset: null })
      expect(data(await client.callTool({ name: 'get_valuation', arguments: { asOf: '1980-01-10' } }))).toEqual({ positions: [] })
      expect((await client.callTool({ name: 'add_transaction', arguments: {} })).isError).toBe(true)
    }))
  })

  it('rejects invalid dates, reversed bounds, unbounded pages and unknown fields', async () => {
    await withIsolatedDatabase((sql) => connected(sql, true, async (client) => {
      for (const args of [{ from: '1980-02-30' }, { from: '1980-02-01', to: '1980-01-01' }, { limit: 101 }, { offset: -1 }, { sql: 'SELECT 1' }]) {
        expect((await client.callTool({ name: 'list_activities', arguments: args })).isError).toBe(true)
      }
      expect((await client.callTool({ name: 'get_valuation', arguments: { asOf: 'not-a-date' } })).isError).toBe(true)
    }))
  })

  it('records all six entry types and returns exact decimals with filtered UTC pagination', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id: accountId } = await createAccount(sql, { name: 'Synthetic broker', currency: 'EUR' })
      const other = await createAccount(sql, { name: 'Other broker', currency: 'USD' })
      await connected(sql, true, async (client) => {
        const add = (args: Record<string, unknown>) => client.callTool({ name: 'add_transaction', arguments: { accountId, ...args } })
        expect(data(await add(buy)).id).toEqual(expect.any(String))
        data(await add({ ...buy, type: 'SELL', quantity: '0.5', date: '1980-01-03' }))
        for (const type of ['DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE']) {
          data(await add({ type, date: '1980-01-04', currency: 'EUR', amount: '1.23' }))
        }
        data(await add({ ...buy, accountId: other.id }))
        const accounts = data(await client.callTool({ name: 'list_accounts', arguments: {} })).accounts
        expect(accounts).toEqual(expect.arrayContaining([{ id: accountId, name: 'Synthetic broker', currency: 'EUR', isExcluded: false }]))
        const page = data(await client.callTool({ name: 'list_activities', arguments: { accountId, from: '1980-01-02', to: '1980-01-04', limit: 2 } }))
        expect(page.nextOffset).toBe(2)
        expect(page.activities).toMatchObject([{ type: 'BUY', quantity: '2.5', unitPrice: '10.1', fee: '0.2', date: '1980-01-02T00:00:00.000Z' }, { type: 'SELL' }])
        const next = data(await client.callTool({ name: 'list_activities', arguments: { accountId, offset: 2 } }))
        expect((next.activities as unknown[]).length).toBe(4)
        expect(next.nextOffset).toBeNull()
        expect(data(await client.callTool({ name: 'list_activities', arguments: { accountId, type: 'FEE', from: '1980-01-04', to: '1980-01-04' } })).activities).toMatchObject([{ type: 'FEE' }])
      })
    })
  })

  it('rejects duplicates, unknown accounts, invalid amounts, force and overselling without saving', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id: accountId } = await createAccount(sql, { name: 'Synthetic broker', currency: 'EUR' })
      await connected(sql, true, async (client) => {
        const add = (args: Record<string, unknown>) => client.callTool({ name: 'add_transaction', arguments: { accountId, ...args } })
        data(await add(buy))
        for (const args of [buy, { ...buy, accountId: crypto.randomUUID() }, { ...buy, quantity: '0' }, { ...buy, date: '1980-02-30' }, { ...buy, force: true }, { ...buy, quantity: 2 }, { ...buy, type: 'SELL', quantity: '3' }]) {
          expect((await add(args)).isError).toBe(true)
        }
        expect((await readLedger(sql)).activities).toHaveLength(1)
        const concurrent = await Promise.all([add({ ...buy, date: '1980-01-03' }), add({ ...buy, date: '1980-01-03' })])
        expect(concurrent.filter((response) => !response.isError)).toHaveLength(1)
        expect((await readLedger(sql)).activities).toHaveLength(2)
      })
    })
  })

  it('preserves missing and stale quote statuses and the valuation date restriction', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id: accountId } = await createAccount(sql, { name: 'Synthetic broker', currency: 'EUR' })
      await sql.unsafe(cacheTables)
      await connected(sql, true, async (client) => {
        data(await client.callTool({ name: 'add_transaction', arguments: { accountId, ...buy } }))
        const valuation = () => client.callTool({ name: 'get_valuation', arguments: { asOf: '1980-01-10' } })
        expect(data(await valuation()).positions).toMatchObject([{ status: 'quote-required' }])
        await sql`INSERT INTO security_quotes VALUES ('SYNTHETIC', '1980-01-02', 15, 'EUR', 'synthetic', now())`
        expect(data(await valuation()).positions).toMatchObject([{ status: 'quote-stale' }])
        expect((await client.callTool({ name: 'get_valuation', arguments: { asOf: '1980-01-01' } })).isError).toBe(true)
      })
    })
  })

  it('enforces read-only connections at the database layer', async () => {
    await withIsolatedDatabase(async (sql) => {
      await createAccount(sql, { name: 'Synthetic broker', currency: 'EUR' })
      const url = new URL(process.env.DATABASE_URL ?? '')
      url.pathname = '/portfolio_test'
      const [{ schema }] = await sql`SELECT current_schema() AS schema`
      url.searchParams.set('search_path', schema)
      const reader = openReadOnly(url.toString())
      try {
        await expect(reader`INSERT INTO accounts (name, currency) VALUES ('Forbidden', 'EUR')`).rejects.toThrow(/read-only/)
        await connected(reader, false, async (client) => {
          expect(data(await client.callTool({ name: 'list_accounts', arguments: {} })).accounts).toHaveLength(1)
        })
      } finally { await reader.end() }
    })
  })

  it('does not leak infrastructure errors or claim a failed write is safe to retry', async () => {
    await withIsolatedDatabase(async (sql) => {
      await sql.end()
      await connected(sql, true, async (client) => {
        const read = await client.callTool({ name: 'list_accounts', arguments: {} })
        expect(read).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Portfolio data could not be read.' }] })
        const write = await client.callTool({ name: 'add_transaction', arguments: { accountId: crypto.randomUUID(), ...buy } })
        expect(write).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('may have committed') }] })
      })
    })
  })
})
