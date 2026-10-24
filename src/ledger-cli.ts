import { parseArgs } from 'node:util'
import type { Sql } from 'postgres'
import { addTransaction, createAccount, hasCachedPrice, listAccounts } from './ledger-entry'

const usage = `Usage: ledger:add account --name <name> --currency <EUR|USD> [--comment <text>]
       ledger:add accounts
       ledger:add transaction --account <id> --type <BUY|SELL|DIVIDEND|DEPOSIT|WITHDRAWAL|FEE> --date <date> --currency <EUR|USD>
         [--symbol <ticker> --quantity <n> --unit-price <n> [--fee <n>]] [--amount <n>] [--comment <text>] [--force]`

function parse<Required extends string>(args: string[], options: Record<string, { type: 'string' }>, required: Required[]) {
  try {
    const { values } = parseArgs({ args, options, allowPositionals: false })
    if (required.some((name) => values[name] === undefined)) throw new Error()
    return values as Record<Required, string> & Record<string, string | undefined>
  } catch {
    throw new Error(usage)
  }
}

export async function runLedgerCli(sql: Sql, args: string[], warn: (message: string) => void = () => {}) {
  const [command, ...rest] = args
  if (command === 'account') {
    const values = parse(rest, { name: { type: 'string' }, currency: { type: 'string' }, comment: { type: 'string' } }, ['name', 'currency'])
    const { id } = await createAccount(sql, { name: values.name, currency: values.currency, comment: values.comment })
    return `account\t${id}\n`
  }
  if (command === 'accounts') {
    parse(rest, {}, [])
    return (await listAccounts(sql)).map((account) => `${account.id}\t${account.name}\t${account.currency}\t${account.comment ?? ''}\n`).join('')
  }
  if (command === 'transaction') {
    // --force is the only flag without a value, so it is taken out before the value options are parsed.
    const force = rest.includes('--force')
    const values = parse(rest.filter((arg) => arg !== '--force'), {
      account: { type: 'string' }, type: { type: 'string' }, date: { type: 'string' }, currency: { type: 'string' },
      symbol: { type: 'string' }, quantity: { type: 'string' }, 'unit-price': { type: 'string' }, fee: { type: 'string' },
      amount: { type: 'string' }, comment: { type: 'string' },
    }, ['account', 'type', 'date', 'currency'])
    const { id } = await addTransaction(sql, {
      accountId: values.account, type: values.type, date: values.date, currency: values.currency, symbol: values.symbol,
      quantity: values.quantity, unitPrice: values['unit-price'], fee: values.fee, amount: values.amount, comment: values.comment, force,
    })
    if (values.type === 'BUY' && values.symbol !== undefined && !(await hasCachedPrice(sql, values.symbol.trim()))) {
      warn(`No price cached for ${values.symbol.trim()} yet; it is valued after the next worker refresh (docs/yfinance-worker.md), which lists a symbol Yahoo does not know as failed.`)
    }
    return `transaction\t${id}\n`
  }
  throw new Error(usage)
}
