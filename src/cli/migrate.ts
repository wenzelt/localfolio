import postgres from 'postgres'
import { runMigrateCli } from '../migrate-cli'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
const sql = postgres(url)
try {
  process.stdout.write(await runMigrateCli(sql, process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await sql.end()
}
