import { describe, expect, it } from 'vitest'

import { calculateCash, withCash } from './cash'

describe('withCash', () => {
  const stock = { accountId: 'a', accountName: 'Broker', symbol: 'AAA', name: 'Alpha', value: '300', changePercent: '2', observedOn: '2026-10-21', previousOn: '2026-10-20' }

  it('appends a Cash position with a fixed EUR 0 value after the other positions', () => {
    const items = withCash([stock])
    expect(items[0]).toEqual(stock)
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ symbol: 'CASH', name: 'Cash', value: '0', kind: 'cash' })
  })

  it('leaves an empty portfolio empty', () => {
    expect(withCash([])).toEqual([])
  })
})

const eur = (type: Parameters<typeof calculateCash>[0][number]['type'], quantity: string, unitPrice: string, fee = '0') =>
  ({ type, quantity, unitPrice, fee, currency: 'EUR' as const })

describe('calculateCash', () => {
  it('returns zero for an account without activities', () => {
    expect(calculateCash([])).toEqual({ cash: '0', dividends: '0', fees: '0' })
  })

  it('adds deposits, dividends and sale proceeds and subtracts withdrawals, fees and purchase costs', () => {
    expect(calculateCash([
      eur('DEPOSIT', '1', '1000'),
      eur('BUY', '10', '10', '1'),
      eur('SELL', '5', '12', '1'),
      eur('DIVIDEND', '1', '3'),
      eur('WITHDRAWAL', '1', '50'),
      eur('FEE', '1', '2'),
    ])).toEqual({ cash: '909', dividends: '3', fees: '4' })
  })

  it('keeps fractional amounts exact', () => {
    expect(calculateCash([eur('DEPOSIT', '1', '0.1'), eur('DEPOSIT', '1', '0.2')]).cash).toBe('0.3')
  })

  it('converts USD activities at their historical rate', () => {
    expect(calculateCash([
      { type: 'DEPOSIT', quantity: '1', unitPrice: '100', fee: '0', currency: 'USD', eurPerUsd: '0.5' },
      { type: 'FEE', quantity: '1', unitPrice: '4', fee: '0', currency: 'USD', eurPerUsd: '0.25' },
    ])).toEqual({ cash: '49', dividends: '0', fees: '1' })
  })

  it('rejects a USD activity without a historical rate', () => {
    expect(() => calculateCash([{ type: 'DEPOSIT', quantity: '1', unitPrice: '1', fee: '0', currency: 'USD' }]))
      .toThrow('Historical USD/EUR rate is required')
  })

  it('reports a negative balance instead of rejecting it', () => {
    expect(calculateCash([eur('WITHDRAWAL', '1', '10')]).cash).toBe('-10')
  })
})
