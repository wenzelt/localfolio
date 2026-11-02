import { describe, expect, it } from 'vitest'
import type { LedgerAccount, LedgerActivity } from './ledger-store'
import { transactionsCsv, transactionsHeader } from './transactions-csv'

const account = (id: string, name: string): LedgerAccount => ({ id, externalId: null, name, currency: 'EUR', balance: '0', comment: null, isExcluded: false, balances: [] })
const activity = (patch: Partial<LedgerActivity>): LedgerActivity => ({
  id: 'tx', accountId: 'a1', type: 'BUY', symbol: 'VWCE.DE', dataSource: 'YAHOO', currency: 'EUR',
  quantity: '1', unitPrice: '100', fee: '0', date: '2026-01-02T00:00:00.000Z', comment: null, tags: [], ...patch,
})
const accounts = [account('a1', 'Broker'), account('a2', 'Savings')]
const lines = (csv: string) => csv.split('\r\n')

describe('transactions as CSV', () => {
  it('starts with a fixed header naming every column', () => {
    expect(transactionsHeader).toBe('date,account,type,symbol,quantity,unit_price,fee,currency,comment,tags')
    expect(lines(transactionsCsv([], []))[0]).toBe(transactionsHeader)
  })

  it('is just the header when there is nothing to export', () => {
    expect(transactionsCsv([], [])).toBe(`${transactionsHeader}\r\n`)
  })

  it('writes one row per transaction with the account name, in the order given', () => {
    const csv = transactionsCsv(accounts, [
      activity({ id: '1', quantity: '12.5', unitPrice: '100.25', fee: '1.5', comment: 'first lot' }),
      activity({ id: '2', accountId: 'a2', type: 'SELL', symbol: 'AAPL', currency: 'USD', quantity: '3', unitPrice: '210', date: '2026-02-03T09:30:00.000Z' }),
    ])
    expect(lines(csv)).toEqual([
      transactionsHeader,
      '2026-01-02T00:00:00.000Z,Broker,BUY,VWCE.DE,12.5,100.25,1.5,EUR,first lot,',
      '2026-02-03T09:30:00.000Z,Savings,SELL,AAPL,3,210,0,USD,,',
      '',
    ])
  })

  it('keeps decimals exactly as stored, without passing them through a float', () => {
    const [, row] = lines(transactionsCsv(accounts, [activity({ quantity: '2.80', unitPrice: '0.1000000001', fee: '0.30' })]))
    expect(row).toContain(',2.80,0.1000000001,0.30,')
  })

  it('leaves the symbol empty for cash movements', () => {
    const [, row] = lines(transactionsCsv(accounts, [activity({ type: 'DEPOSIT', symbol: null, dataSource: null, unitPrice: '500' })]))
    expect(row).toBe('2026-01-02T00:00:00.000Z,Broker,DEPOSIT,,1,500,0,EUR,,')
  })

  it('joins tags with semicolons in one column', () => {
    const [, row] = lines(transactionsCsv(accounts, [activity({ tags: ['core', 'long term'] })]))
    expect(row.endsWith(',core;long term')).toBe(true)
  })

  it('quotes fields holding commas, quotes or line breaks, and doubles inner quotes', () => {
    const csv = transactionsCsv([account('a1', 'Smith, J.')], [activity({ comment: 'said "buy"\nlater' })])
    expect(csv).toContain('"Smith, J."')
    expect(csv).toContain('"said ""buy""\nlater"')
    // A line break inside a quoted field is data, not a new record.
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  // Text that opens with one of these is read as a formula by Excel, Numbers and Sheets, so it gets a leading apostrophe.
  it.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+1', "'+1"],
    ['-2', "'-2"],
    ['@cmd', "'@cmd"],
    ['\tcell', "'\tcell"],
    ['\rcell', `"'\rcell"`],
  ])('stops a spreadsheet from running account, comment and tag text that starts with %j', (text, written) => {
    const csv = transactionsCsv([account('a1', text)], [activity({ comment: text, tags: [text] })])
    expect(csv).toBe(`${transactionsHeader}\r\n2026-01-02T00:00:00.000Z,${written},BUY,VWCE.DE,1,100,0,EUR,${written},${written}\r\n`)
  })

  it('does not alter text that merely contains such a character later on', () => {
    const [, row] = lines(transactionsCsv([account('a1', 'A=B')], [activity({ comment: 'cost - fees', symbol: '^GSPC' })]))
    expect(row).toBe('2026-01-02T00:00:00.000Z,A=B,BUY,^GSPC,1,100,0,EUR,cost - fees,')
  })
})
