import { describe, expect, it } from 'vitest'
import { calculatePosition, type Transaction } from './ledger'

const buy: Transaction = { type: 'BUY', quantity: '0.3', unitPrice: '10', fee: '0.1', currency: 'EUR' }

describe('EUR position valuation', () => {
  it('values fractional holdings and subtracts fee-inclusive basis exactly', () => {
    expect(calculatePosition([buy], 'EUR', { price: '12', currency: 'EUR' })).toMatchObject({ marketValue: '3.6', unrealizedGain: '0.5' })
  })

  it('uses quote currency independently of trade currency', () => {
    expect(calculatePosition([buy], 'EUR', { price: '10', currency: 'USD', eurPerUsd: '0.9' })).toMatchObject({ marketValue: '2.7', unrealizedGain: '-0.4' })
  })

  it('does not round recurring cost basis before subtracting', () => {
    const trades: Transaction[] = [
      { ...buy, quantity: '3', unitPrice: '1', fee: '1' },
      { ...buy, type: 'SELL', quantity: '2', unitPrice: '2', fee: '0' },
    ]
    expect(calculatePosition(trades, 'EUR', { price: '2', currency: 'EUR' })).toMatchObject({ marketValue: '2', unrealizedGain: '0.66666666666666666666666666' })
  })

  it('values a closed position at zero', () => {
    expect(calculatePosition([buy, { ...buy, type: 'SELL' }], 'EUR', { price: '12', currency: 'EUR' })).toMatchObject({ marketValue: '0', unrealizedGain: '0' })
  })

  it('requires EUR reporting when a valuation quote is supplied', () => {
    expect(() => calculatePosition([buy], undefined, { price: '12', currency: 'EUR' })).toThrow('Valuation requires EUR reporting')
  })

  it('rejects missing conversion, unsupported currency and invalid prices', () => {
    for (const quote of [
      { price: '1', currency: 'USD' }, { price: '1', currency: 'GBP' },
      { price: '0', currency: 'EUR' }, { price: '-1', currency: 'EUR' },
      { price: '1', currency: 'USD', eurPerUsd: '0' },
    ]) expect(() => calculatePosition([buy], 'EUR', quote)).toThrow()
  })
})
