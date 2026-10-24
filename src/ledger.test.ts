import { describe, expect, it } from 'vitest'

import { calculatePosition } from './ledger'

describe('calculatePosition', () => {
  it('removes weighted-average cost on partial sales and subtracts sale fees', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '10', unitPrice: '10', fee: '10', currency: 'EUR' },
      { type: 'BUY', quantity: '10', unitPrice: '20', fee: '10', currency: 'EUR' },
      { type: 'SELL', quantity: '5', unitPrice: '25', fee: '5', currency: 'EUR' },
    ])).toEqual({ quantity: '15', averageCost: '16', invested: '240', realizedGain: '40', currency: 'EUR' })
  })

  it('closes a position and formats a negative fractional realised gain', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '0.3', unitPrice: '10', fee: '0', currency: 'USD' },
      { type: 'SELL', quantity: '0.3', unitPrice: '9', fee: '0.2', currency: 'USD' },
    ])).toEqual({ quantity: '0', averageCost: '0', invested: '0', realizedGain: '-0.5', currency: 'USD' })
  })

  it('starts a new cost basis after closing and reopening a position', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '1', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'SELL', quantity: '1', unitPrice: '12', fee: '0', currency: 'EUR' },
      { type: 'BUY', quantity: '2', unitPrice: '20', fee: '0', currency: 'EUR' },
    ])).toEqual({ quantity: '2', averageCost: '20', invested: '40', realizedGain: '2', currency: 'EUR' })
  })

  it('rejects an oversale at the point it occurs', () => {
    expect(() => calculatePosition([
      { type: 'BUY', quantity: '1', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'SELL', quantity: '2', unitPrice: '12', fee: '0', currency: 'EUR' },
      { type: 'BUY', quantity: '2', unitPrice: '10', fee: '0', currency: 'EUR' },
    ])).toThrow('Cannot sell more than held')
  })
  it('includes fees in invested cost', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '2', unitPrice: '10', fee: '1', currency: 'EUR' },
    ])).toEqual({ quantity: '2', averageCost: '10.5', invested: '21', realizedGain: '0', currency: 'EUR' })
  })

  it('adds decimal quantities exactly', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '0.1', unitPrice: '1', fee: '0', currency: 'EUR' },
      { type: 'BUY', quantity: '0.2', unitPrice: '1', fee: '0', currency: 'EUR' },
    ]).quantity).toBe('0.3')
  })

  it('counts a dividend as realised income without touching quantity or cost basis', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '10', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'DIVIDEND', quantity: '1', unitPrice: '3.5', fee: '0', currency: 'EUR' },
    ])).toEqual({ quantity: '10', averageCost: '10', invested: '100', realizedGain: '3.5', currency: 'EUR' })
  })

  it('converts a USD dividend at its historical rate when reporting in EUR', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '10', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'DIVIDEND', quantity: '1', unitPrice: '4', fee: '0', currency: 'USD', eurPerUsd: '0.5' },
    ], 'EUR')).toMatchObject({ quantity: '10', realizedGain: '2' })
  })

  it('adds a dividend to the gain realised by a later partial sale', () => {
    expect(calculatePosition([
      { type: 'BUY', quantity: '10', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'DIVIDEND', quantity: '1', unitPrice: '3', fee: '0', currency: 'EUR' },
      { type: 'SELL', quantity: '5', unitPrice: '12', fee: '0', currency: 'EUR' },
    ])).toMatchObject({ quantity: '5', invested: '50', realizedGain: '13' })
  })

  it('rejects an empty transaction list', () => {
    expect(() => calculatePosition([])).toThrow('At least one transaction is required')
  })

  it('rejects mixed currencies until FX conversion is implemented', () => {
    expect(() => calculatePosition([
      { type: 'BUY', quantity: '1', unitPrice: '10', fee: '0', currency: 'EUR' },
      { type: 'BUY', quantity: '1', unitPrice: '10', fee: '0', currency: 'USD' },
    ])).toThrow('Transactions must have the same currency')
  })

  it.each(['-1', 'NaN', '', '1e2', '1.2.3'])('rejects invalid decimal %j', (quantity) => {
    expect(() => calculatePosition([
      { type: 'BUY', quantity, unitPrice: '10', fee: '0', currency: 'EUR' },
    ])).toThrow('Invalid decimal value')
  })

  it('rejects a zero total quantity', () => {
    expect(() => calculatePosition([
      { type: 'BUY', quantity: '0', unitPrice: '10', fee: '0', currency: 'EUR' },
    ])).toThrow('Cannot divide by zero')
  })
  it('calculates a fractional USD position with a weighted-average cost basis', () => {
    const position = calculatePosition([
      {
        type: 'BUY',
        quantity: '2.8',
        unitPrice: '81',
        fee: '0',
        currency: 'USD',
      },
      {
        type: 'BUY',
        quantity: '4',
        unitPrice: '84.8',
        fee: '0',
        currency: 'USD',
      },
    ])

    expect(position).toEqual({
      quantity: '6.8',
      averageCost: '83.23529411764705882352941176',
      invested: '566',
      realizedGain: '0',
      currency: 'USD',
    })
  })
})
