import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { dailyMovement, readDailyMovement } from './daily-movement'
import { importGhostfolioExport } from './ledger-store'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'

const accounts = [{ id: 'a1', name: 'Synthetic one' }, { id: 'a2', name: 'Synthetic two' }]
type Trade = { accountId: string; symbol: string; type: 'BUY' | 'SELL'; quantity: string; date: string }
const buy = (accountId: string, symbol: string, quantity: string, date = '1979-12-01'): Trade => ({ accountId, symbol, type: 'BUY', quantity, date })
const bar = (symbol: string, observedOn: string, close: string, currency: 'EUR' | 'USD' = 'EUR') => ({ symbol, observedOn, close, currency })
const run = (trades: Trade[], prices: ReturnType<typeof bar>[], rates: { date: string; eurPerUsd: string }[] = [], asOf = '1980-01-07') =>
  dailyMovement({ accounts, trades, prices, rates }, asOf)

describe('daily movement', () => {
  it('values the position and reports the percent change against the previous bar', () => {
    expect(run([buy('a1', 'X', '1.5')], [bar('X', '1980-01-04', '10'), bar('X', '1980-01-07', '11')])).toEqual([
      { accountId: 'a1', accountName: 'Synthetic one', symbol: 'X', value: '16.5', change: '1.5', changePercent: '10', observedOn: '1980-01-07', previousOn: '1980-01-04' },
    ])
  })

  it('reports a loss as negative and a flat day as a real zero', () => {
    const [flat, loss] = run([buy('a1', 'L', '1'), buy('a1', 'F', '1')], [
      bar('L', '1980-01-04', '8'), bar('L', '1980-01-07', '6'), bar('F', '1980-01-04', '5'), bar('F', '1980-01-07', '5'),
    ])
    expect(loss).toMatchObject({ symbol: 'L', changePercent: '-25', change: '-2' })
    expect(flat).toMatchObject({ symbol: 'F', changePercent: '0', value: '5', change: '0' })
  })

  it('compares against the previous available bar across a weekend or holiday', () => {
    const prices = [bar('X', '1980-01-03', '20'), bar('X', '1980-01-07', '21')]
    expect(run([buy('a1', 'X', '1')], prices)[0]).toMatchObject({ changePercent: '5', observedOn: '1980-01-07', previousOn: '1980-01-03' })
  })

  it('uses the newest bar at or before the cutoff and ignores later bars', () => {
    const prices = [bar('X', '1980-01-03', '10'), bar('X', '1980-01-04', '12'), bar('X', '1980-01-07', '99')]
    expect(run([buy('a1', 'X', '1')], prices, [], '1980-01-06')[0]).toMatchObject({ value: '12', changePercent: '20', observedOn: '1980-01-04', previousOn: '1980-01-03' })
  })

  it('ignores trades after the cutoff and drops positions closed by the cutoff', () => {
    const prices = [bar('X', '1980-01-04', '10'), bar('X', '1980-01-07', '11'), bar('Y', '1980-01-04', '10'), bar('Y', '1980-01-07', '11')]
    const trades = [
      buy('a1', 'X', '2'), { ...buy('a1', 'X', '2', '1980-01-07'), type: 'SELL' as const },
      buy('a1', 'Y', '2'), buy('a1', 'Y', '5', '1980-01-08'),
    ]
    expect(run(trades, prices).map((item) => [item.symbol, item.value])).toEqual([['Y', '22']])
    expect(run([buy('a1', 'X', '2'), { ...buy('a1', 'X', '2', '1980-01-04'), type: 'SELL' as const }], prices)).toEqual([])
  })

  it('keeps the exact quantity of fractional buys and partial sells', () => {
    const trades = [buy('a1', 'X', '0.1'), buy('a1', 'X', '0.2'), { ...buy('a1', 'X', '0.05', '1979-12-02'), type: 'SELL' as const }]
    expect(run(trades, [bar('X', '1980-01-04', '10'), bar('X', '1980-01-07', '10')])[0].value).toBe('2.5')
  })

  it('refuses to report a position sold beyond what was held', () => {
    expect(() => run([{ ...buy('a1', 'X', '1'), type: 'SELL' as const }], [bar('X', '1980-01-07', '1')])).toThrow('Sold more than held')
  })

  it('keeps the same symbol in two accounts separate', () => {
    const prices = [bar('X', '1980-01-04', '10'), bar('X', '1980-01-07', '10')]
    expect(run([buy('a1', 'X', '1'), buy('a2', 'X', '4')], prices).map((item) => [item.accountId, item.value])).toEqual([['a1', '10'], ['a2', '40']])
  })

  it('converts a USD position at the latest rate at or before the cutoff', () => {
    const prices = [bar('U', '1980-01-04', '10', 'USD'), bar('U', '1980-01-07', '20', 'USD')]
    const rates = [{ date: '1980-01-02', eurPerUsd: '0.5' }, { date: '1980-01-05', eurPerUsd: '0.9' }, { date: '1980-01-08', eurPerUsd: '2' }]
    // The percent change stays in the quote currency, so FX does not leak into it.
    expect(run([buy('a1', 'U', '1')], prices, rates)[0]).toMatchObject({ value: '18', change: '9', changePercent: '100' })
  })

  it('leaves the value empty but keeps the change when the FX rate is missing or stale', () => {
    const prices = [bar('U', '1980-01-04', '10', 'USD'), bar('U', '1980-01-07', '20', 'USD')]
    const expected = { value: null, change: null, changePercent: '100', observedOn: '1980-01-07', previousOn: '1980-01-04' }
    expect(run([buy('a1', 'U', '1')], prices, [])[0]).toMatchObject(expected)
    expect(run([buy('a1', 'U', '1')], prices, [{ date: '1979-12-29', eurPerUsd: '0.9' }])[0]).toMatchObject(expected)
    expect(run([buy('a1', 'U', '1')], prices, [{ date: '1979-12-31', eurPerUsd: '0.9' }])[0]).toMatchObject({ value: '18', change: '9' })
  })

  it('never reports a false zero when the reference bar is missing', () => {
    expect(run([buy('a1', 'X', '1')], [bar('X', '1980-01-07', '11')])[0]).toEqual(
      { accountId: 'a1', accountName: 'Synthetic one', symbol: 'X', value: '11', change: null, changePercent: null, observedOn: '1980-01-07', previousOn: null },
    )
    expect(run([buy('a1', 'X', '1')], [bar('X', '1980-01-07', '11'), bar('X', '1979-12-01', '5')])[0]).toMatchObject({ changePercent: null, previousOn: null })
    expect(run([buy('a1', 'X', '1')], [bar('X', '1980-01-04', '0'), bar('X', '1980-01-07', '11')])[0]).toMatchObject({ value: '11', changePercent: null })
    expect(run([buy('a1', 'X', '1')], [bar('X', '1980-01-04', '10', 'USD'), bar('X', '1980-01-07', '11')])[0]).toMatchObject({ changePercent: null })
  })

  it('reports nothing for a symbol with no fresh price', () => {
    const empty = { value: null, change: null, changePercent: null, observedOn: null, previousOn: null }
    expect(run([buy('a1', 'X', '1')], [])[0]).toMatchObject(empty)
    expect(run([buy('a1', 'X', '1')], [bar('X', '1979-12-29', '10'), bar('X', '1979-12-28', '9')])[0]).toMatchObject(empty)
  })
})

describe('daily movement from the database', () => {
  async function setup(sql: Sql) {
    const symbol = `SYNTHETIC-${crypto.randomUUID()}`
    const account = (name: string, isExcluded: boolean) =>
      ({ id: crypto.randomUUID(), name, currency: 'EUR', balance: 0, balances: [], comment: null, isExcluded, platformId: null })
    const [first, second, excluded] = [account('B synthetic', false), account('A synthetic', false), account('Excluded', true)]
    const trade = (accountId: string, name: string, type: string, quantity: number) =>
      ({ accountId, type, symbol: name, dataSource: 'YAHOO', currency: 'EUR', quantity, unitPrice: 1, fee: 0, date: '1979-12-01T10:00:00.000Z', comment: null, tags: [] })
    await importGhostfolioExport(sql, JSON.stringify({
      meta: { version: '0.0.1', date: '1980-01-02T12:00:00.000Z' },
      accounts: [first, second, excluded],
      activities: [
        trade(first.id, symbol, 'BUY', 1), trade(second.id, symbol, 'BUY', 3), trade(excluded.id, symbol, 'BUY', 100),
        trade(first.id, 'CLOSED', 'BUY', 2), trade(first.id, 'CLOSED', 'SELL', 2),
      ],
      assetProfiles: [], platforms: [], tags: [],
      user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
    }))
    await sql.unsafe(cacheTables)
    await sql`INSERT INTO security_prices VALUES (${symbol}, '1980-01-04', 10, 'EUR', 'yfinance', now()), (${symbol}, '1980-01-07', 12, 'EUR', 'yfinance', now()), (${symbol}, '1980-01-08', 99, 'EUR', 'yfinance', now())`
    return symbol
  }

  it('reads open, included positions per account and ignores later bars', async () => {
    await withIsolatedDatabase(async (sql) => {
      const symbol = await setup(sql)
      const items = await readDailyMovement(sql, '1980-01-07')
      expect(items.map(({ accountName, symbol: name, value, changePercent, observedOn, previousOn }) => ({ accountName, name, value, changePercent, observedOn, previousOn }))).toEqual([
        { accountName: 'B synthetic', name: symbol, value: '12', changePercent: '20', observedOn: '1980-01-07', previousOn: '1980-01-04' },
        { accountName: 'A synthetic', name: symbol, value: '36', changePercent: '20', observedOn: '1980-01-07', previousOn: '1980-01-04' },
      ])
    })
  })

  it('reads an empty ledger and a missing cache without failing', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await readDailyMovement(sql, '1980-01-07')).toEqual([])
    })
  })
})
