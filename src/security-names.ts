import type { Sql } from 'postgres'

export async function readSecurityNames(sql: Sql): Promise<Record<string, string>> {
  const [table] = await sql`SELECT to_regclass('security_names') AS name`
  if (table.name === null) return {}
  const rows = await sql<{ symbol: string; name: string }[]>`SELECT symbol, name FROM security_names`
  return Object.fromEntries(rows.map((row) => [row.symbol, row.name]))
}
