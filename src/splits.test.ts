import { describe, expect, it } from 'vitest'
import { adjustForSplits, readSplits } from './splits'
import { calculatePerformance } from './performance'
import { dailyMovement } from './daily-movement'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'

const buy = (symbol: string, date: string, quantity: string, unitPrice: string) =>
  ({ type: 'BUY' as const, date: `${date}T10:00:00.000Z`, symbol, quantity, unitPrice, fee: '0', currency: 'EUR' as const })
const split = (symbol: string, effectiveOn: string, ratio: string) => ({ symbol, effectiveOn, ratio })

describe('adjustForSplits', () => {
  it('scales a trade from before the split into post-split shares and keeps what was paid', () => {
    const [trade] = adjustForSplits([buy('ANX.PA', '2026-10-01', '10', '240')], [split('ANX.PA', '2026-11-23', '60')])
    expect(trade).toMatchObject({ quantity: '600', unitPrice: '4' })
  })

  it('leaves trades on or after the effective day and other symbols alone', () => {
    const trades = [buy('ANX.PA', '2026-11-23', '5', '4.5'), buy('ANX.PA', '2026-11-24', '5', '4.6'), buy('OTHER', '2026-10-01', '1', '10')]
    expect(adjustForSplits(trades, [split('ANX.PA', '2026-11-23', '60')])).toEqual(trades)
  })

  it('compounds several splits and handles a reverse split', () => {
    const splits = [split('X', '2026-02-01', '2'), split('X', '2026-03-01', '3'), split('Y', '2026-02-01', '0.1')]
    expect(adjustForSplits([buy('X', '2026-01-01', '1', '60')], splits)[0]).toMatchObject({ quantity: '6', unitPrice: '10' })
    expect(adjustForSplits([buy('X', '2026-02-15', '1', '60')], splits)[0]).toMatchObject({ quantity: '3', unitPrice: '20' })
    expect(adjustForSplits([buy('Y', '2026-01-01', '100', '1')], splits)[0]).toMatchObject({ quantity: '10', unitPrice: '10' })
  })

  it('does not touch cash movements, which carry no symbol', () => {
    const deposit = { type: 'DEPOSIT' as const, date: '2026-01-01T00:00:00.000Z', symbol: null, quantity: '1', unitPrice: '100', fee: '0', currency: 'EUR' as const }
    expect(adjustForSplits([deposit], [split('X', '2026-02-01', '2')])).toEqual([deposit])
  })
})

describe('a split in the valuation', () => {
  const prices = [
    { symbol: 'ANX.PA', observedOn: '2026-10-01', close: '4', currency: 'EUR' as const }, // Adjusted: 240 / 60
    { symbol: 'ANX.PA', observedOn: '2026-11-20', close: '4.4666667', currency: 'EUR' as const }, // Adjusted: 268 / 60
    { symbol: 'ANX.PA', observedOn: '2026-11-23', close: '4.7', currency: 'EUR' as const },
  ]
  const splits = [split('ANX.PA', '2026-11-23', '60')]
  const activities = adjustForSplits([buy('ANX.PA', '2026-10-01', '10', '240')], splits)

  it('keeps the chart flat across the split instead of falling about 98%', () => {
    const series = calculatePerformance({ activities, prices, rates: [] }, '2026-11-23', 'MAX').series
    const value = (day: string) => Number(series.find((point) => point.date === day)?.value)
    expect(value('2026-11-20')).toBeCloseTo(2680, 1)
    expect(value('2026-11-23')).toBeCloseTo(2820, 1)
  })

  it('reports Today against the adjusted previous close', () => {
    const trades = activities.map(({ type, date, symbol, quantity }) => ({ accountId: 'a', type, date, symbol, quantity }))
    const [item] = dailyMovement({ accounts: [{ id: 'a', name: 'Broker' }], trades, prices, rates: [] }, '2026-11-23')
    expect(Number(item.changePercent)).toBeCloseTo(5.2, 1)
    expect(Number(item.value)).toBeCloseTo(2820, 1)
  })
})

describe('readSplits', () => {
  it('reads the stored splits of the given symbols and tolerates a missing table', async () => {
    await withIsolatedDatabase(async (sql) => {
      expect(await readSplits(sql, ['ANX.PA'])).toEqual([])
      await sql.unsafe(cacheTables)
      await sql`CREATE TABLE security_splits (symbol text, effective_on date, ratio numeric, source text, fetched_at timestamptz)`
      await sql`INSERT INTO security_splits VALUES ('ANX.PA', '2026-11-23', 60, 'yfinance', now()), ('OTHER', '2026-01-02', 2, 'yfinance', now())`
      expect(await readSplits(sql, ['ANX.PA'])).toEqual([{ symbol: 'ANX.PA', effectiveOn: '2026-11-23', ratio: '60' }])
      expect(await readSplits(sql, [])).toEqual([])
    })
  })
})
