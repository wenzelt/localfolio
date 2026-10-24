import postgres from 'postgres'
import type { Sql } from 'postgres'
import { readValuationReport } from './valuation-report'

const columns = ['quantity', 'invested', 'marketValue', 'unrealizedGain'] as const

export function openReadOnly(url: string): Sql {
  return postgres(url, { connection: { default_transaction_read_only: true } })
}

export async function runValuationCli(sql: Sql, args: string[]) {
  if (args.length !== 1) throw new Error('Usage: report:valuation <YYYY-MM-DD>')
  const [asOf] = args
  const rows = await readValuationReport(sql, asOf)
  if (rows.length === 0) throw new Error('Ledger is empty')
  const lines = rows.map((row) => {
    const values = row as Record<string, unknown>
    return [row.accountName, row.symbol, row.status, ...columns.map((column) => String(values[column] ?? ''))].join('\t')
  })
  return ['account\tsymbol\tstatus\t' + columns.join('\t'), ...lines, ''].join('\n')
}
