import type { LedgerAccount, LedgerActivity } from './ledger-store'

export const transactionsHeader = 'date,account,type,symbol,quantity,unit_price,fee,currency,comment,tags'

// Excel, Numbers and Sheets run a cell that opens with one of these as a formula. Account names, comments and tags are
// free text, so a leading apostrophe turns them back into plain text. Dates and amounts never start with these.
const formulaStart = /^[=+\-@\t\r]/

function field(value: string): string {
  const text = formulaStart.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// Decimals are written as stored, so nothing passes through a float. Rows keep the order they are given in.
export function transactionsCsv(accounts: LedgerAccount[], activities: LedgerActivity[]): string {
  const names = new Map(accounts.map((account) => [account.id, account.name]))
  const rows = activities.map((activity) => [
    activity.date, names.get(activity.accountId) ?? '', activity.type, activity.symbol ?? '', activity.quantity,
    activity.unitPrice, activity.fee, activity.currency, activity.comment ?? '', activity.tags.join(';'),
  ].map(field).join(','))
  return [transactionsHeader, ...rows].map((line) => `${line}\r\n`).join('')
}
