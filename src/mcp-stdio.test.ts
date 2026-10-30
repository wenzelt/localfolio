import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'
import { createAccount } from './ledger-entry'
import { readLedger } from './ledger-store'
import { isolatedDatabase } from './test-support/schema'

const entrypoint = ['--import', 'tsx', 'src/cli/mcp.ts']

describe('MCP stdio executable', () => {
  it.each([false, true])('completes a real protocol session with writes enabled: %s', async (writes) => {
    const { sql, url, drop } = await isolatedDatabase()
    const client = new Client({ name: 'stdio-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath, args: entrypoint,
      env: { DATABASE_URL: url, MCP_ENABLE_WRITES: String(writes) }, stderr: 'pipe',
    })
    let diagnostics = ''
    transport.stderr?.on('data', (chunk) => { diagnostics += String(chunk) })
    try {
      const { id: accountId } = await createAccount(sql, { name: 'Synthetic broker', currency: 'EUR' })
      await client.connect(transport)
      const tools = (await client.listTools()).tools.map((tool) => tool.name)
      expect(tools.includes('add_transaction')).toBe(writes)
      expect(await client.callTool({ name: 'list_accounts', arguments: {} })).toMatchObject({ structuredContent: { accounts: [{ id: accountId }] } })
      const response = await client.callTool({ name: 'add_transaction', arguments: {
        accountId, type: 'DEPOSIT', date: '1980-01-02', currency: 'EUR', amount: '12.34',
      } })
      expect(response.isError === true).toBe(!writes)
      expect((await readLedger(sql)).activities).toHaveLength(writes ? 1 : 0)
      await client.close()
      expect(diagnostics).toBe('')
    } finally {
      await client.close()
      await drop()
    }
  })

  it.each([
    { DATABASE_URL: '', MCP_ENABLE_WRITES: 'false' },
    { DATABASE_URL: 'postgres://synthetic:secret@localhost/unused', MCP_ENABLE_WRITES: 'yes' },
  ])('rejects invalid startup configuration without protocol or credential leakage', (env) => {
    const child = spawnSync(process.execPath, entrypoint, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000 })
    expect(child.status).toBe(1)
    expect(child.stdout).toBe('')
    expect(child.stderr).toContain('MCP server could not start')
    expect(child.stderr).not.toContain('synthetic:secret')
  })
})
