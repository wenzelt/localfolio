import postgres from 'postgres'
import { runLedgerCli } from '../ledger-cli'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
// Notices such as "relation already exists, skipping" would otherwise be printed to stdout, which carries the command's result.
const sql = postgres(url, { onnotice: () => {} })
try {
  process.stdout.write(await runLedgerCli(sql, process.argv.slice(2), console.error))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await sql.end()
}
