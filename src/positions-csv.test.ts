import { describe, expect, it } from 'vitest'
import { parsePositionsCsv } from './positions-csv'

const header = 'account,symbol,quantity,average_price,currency,date\n'
const today = '2026-06-15'

describe('positions CSV validation', () => {
  it('preserves decimals, trims fields and accepts BOM/CRLF and quoted account names', () => {
    expect(parsePositionsCsv('﻿' + header.replace('\n', '\r\n') + '"Broker, personal", vwce.de ,0.123456789123456789,100.20,EUR,2026-01-02\r\n', today)).toEqual([
      { line: 2, account: 'Broker, personal', symbol: 'VWCE.DE', quantity: '0.123456789123456789', averagePrice: '100.20', currency: 'EUR', date: '2026-01-02' },
    ])
  })
  it('supports escaped quotes and ignores empty lines', () => {
    expect(parsePositionsCsv(header + '\n"My ""broker""",AAPL,2,100,USD,2026-01-02\n', today)[0].account).toBe('My "broker"')
  })
  it.each([
    ['', 'header'], [header, 'at least one'], ['symbol,quantity\nAAPL,2', 'header'],
    ['"account,symbol,quantity,average_price,currency,date"\nBroker,AAPL,1,100,USD,2026-01-02', 'header'],
    [header + 'Broker,AAPL,0,100,USD,2026-01-02', 'Row 2'],
    [header + 'Broker,AAPL,1e3,100,USD,2026-01-02', 'quantity'],
    [header + 'Broker,AAPL,1,-1,USD,2026-01-02', 'price'],
    [header + 'Broker,AAPL,1,100,GBP,2026-01-02', 'currency'],
    [header + 'Broker,AAPL,1,100,USD,2026-02-30', 'date'],
    [header + 'Broker,AAPL,1,100,USD,2027-01-01', 'future'],
    [header + 'Broker,,1,100,USD,2026-01-02', 'symbol'],
    [header + ',AAPL,1,100,USD,2026-01-02', 'account'],
    [header + 'Broker,AAPL,1,100,USD', 'columns'],
    [header + '"Broker,AAPL,1,100,USD,2026-01-02', 'quote'],
    [header + 'Bro"ker,AAPL,1,100,USD,2026-01-02', 'quote'],
    [header + '"Broker"oops,AAPL,1,100,USD,2026-01-02', 'quote'],
  ])('rejects invalid input with actionable errors', (csv, message) => {
    expect(() => parsePositionsCsv(csv, today)).toThrow(message)
  })
  it('caps size and row count', () => {
    expect(() => parsePositionsCsv('x'.repeat(1_048_577), today)).toThrow('1 MiB')
    expect(() => parsePositionsCsv(header + 'Broker,AAPL,1,100,USD,2026-01-02\n'.repeat(1001), today)).toThrow('1000')
  })
})
