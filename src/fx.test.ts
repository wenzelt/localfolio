import { describe, expect, it } from 'vitest'
import { calculatePosition } from './ledger'

describe('historical EUR cost basis', () => {
  it('converts USD purchases and fees at purchase rates and EUR sale proceeds directly', () => {
    expect(calculatePosition([
      { type: 'BUY', currency: 'USD', quantity: '2', unitPrice: '10', fee: '2', eurPerUsd: '0.9' },
      { type: 'SELL', currency: 'EUR', quantity: '1', unitPrice: '15', fee: '1' },
    ], 'EUR')).toEqual({ quantity: '1', invested: '9.9', averageCost: '9.9', realizedGain: '4.1', currency: 'EUR' })
  })

  it('uses each USD trade rate, including sale fees', () => {
    expect(calculatePosition([
      { type: 'BUY', currency: 'USD', quantity: '2', unitPrice: '10', fee: '2', eurPerUsd: '0.9' },
      { type: 'SELL', currency: 'USD', quantity: '1', unitPrice: '15', fee: '1', eurPerUsd: '0.8' },
    ], 'EUR')).toEqual({ quantity: '1', invested: '9.9', averageCost: '9.9', realizedGain: '1.3', currency: 'EUR' })
  })

  it('keeps tiny decimal conversions exact', () => {
    expect(calculatePosition([
      { type: 'BUY', currency: 'USD', quantity: '0.1', unitPrice: '0.2', fee: '0.01', eurPerUsd: '0.12345678901234567890123456' },
    ], 'EUR').invested).toBe('0.00370370367037037036703703')
  })

  it('does not need FX for EUR trades', () => {
    expect(calculatePosition([
      { type: 'BUY', currency: 'EUR', quantity: '1', unitPrice: '10', fee: '1' },
    ], 'EUR').invested).toBe('11')
  })

  it('rejects missing USD historical rates', () => {
    expect(() => calculatePosition([
      { type: 'BUY', currency: 'USD', quantity: '1', unitPrice: '10', fee: '0' },
    ], 'EUR')).toThrow('Historical USD/EUR rate is required')
  })

  it.each(['0', '-1', 'NaN', '1e-2', ''])('rejects invalid historical rate %j', (eurPerUsd) => {
    expect(() => calculatePosition([
      { type: 'BUY', currency: 'USD', quantity: '1', unitPrice: '10', fee: '0', eurPerUsd },
    ], 'EUR')).toThrow()
  })

  it('rejects unsupported currencies in EUR mode', () => {
    expect(() => calculatePosition([
      { type: 'BUY', currency: 'GBP', quantity: '1', unitPrice: '10', fee: '0', eurPerUsd: '1' },
    ], 'EUR')).toThrow('Unsupported transaction currency')
  })
})
