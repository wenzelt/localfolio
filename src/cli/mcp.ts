import postgres from 'postgres'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from '../mcp'
import { openReadOnly } from '../valuation-cli'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const setting = process.env.MCP_ENABLE_WRITES
  if (setting !== undefined && setting !== 'true' && setting !== 'false') throw new Error('MCP_ENABLE_WRITES must be true or false')
  const sql = setting === 'true' ? postgres(url) : openReadOnly(url)
  const server = createMcpServer(sql, setting === 'true')
  let closing: Promise<void> | undefined
  const shutdown = () => closing ??= sql.end({ timeout: 5 })
  server.server.onclose = () => { void shutdown().catch(() => { process.exitCode = 1 }) }
  const stop = () => { void server.close().then(shutdown).catch(() => { process.exitCode = 1 }) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await server.connect(new StdioServerTransport())
  } catch (error) {
    await shutdown()
    throw error
  }
}

main().catch(() => {
  console.error('MCP server could not start. Check DATABASE_URL and MCP_ENABLE_WRITES (true or false).')
  process.exitCode = 1
})
