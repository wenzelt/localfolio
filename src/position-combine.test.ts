import { describe, expect, it } from 'vitest'
import { combinePositions } from './positions'

type Part = Parameters<typeof combinePositions>[0][number]
const held = (accountId: string, symbol: string, fields: Record<string, string | boolean> = {}): Part => ({
  accountId, accountName: `Broker ${accountId.toUpperCase()}`, isExcluded: false, symbol, status: 'calculated',
  currency: 'EUR', quantity: '10', averageCost: '100', invested: '1000', realizedGain: '0', ...fields,
}) as Part
const fxRequired = (accountId: string, symbol: string): Part =>
  ({ accountId, accountName: `Broker ${accountId.toUpperCase()}`, isExcluded: false, symbol, status: 'historical-fx-required' }) as Part

describe('one position per symbol', () => {
  it('adds up quantity, cost basis and realised gain over the accounts that hold the symbol', () => {
    const [position, ...rest] = combinePositions([
      held('a', 'X', { quantity: '10', invested: '1000', averageCost: '100', realizedGain: '5' }),
      held('b', 'X', { quantity: '10', invested: '2000', averageCost: '200', realizedGain: '-2' }),
    ])
    expect(rest).toEqual([])
    expect(position).toEqual({
      symbol: 'X', accounts: [{ id: 'a', name: 'Broker A' }, { id: 'b', name: 'Broker B' }],
      status: 'calculated', currency: 'EUR', quantity: '20', invested: '3000', averageCost: '150', realizedGain: '3',
    })
  })

  it('does not depend on which account holds what', () => {
    const forwards = combinePositions([held('a', 'X', { quantity: '4', invested: '400' }), held('b', 'X', { quantity: '6', invested: '900' })])
    const swapped = combinePositions([held('a', 'X', { quantity: '6', invested: '900' }), held('b', 'X', { quantity: '4', invested: '400' })])
    expect(swapped[0]).toMatchObject({ quantity: '10', invested: '1300', averageCost: '130' })
    expect(forwards[0]).toMatchObject({ quantity: '10', invested: '1300', averageCost: '130' })
  })

  it('names only accounts that still hold it, but keeps the gains an emptied account realised', () => {
    const [position] = combinePositions([
      held('a', 'X', { quantity: '0', invested: '0', averageCost: '0', realizedGain: '12' }),
      held('b', 'X', { quantity: '3', invested: '300', averageCost: '100', realizedGain: '1' }),
    ])
    expect(position).toMatchObject({ accounts: [{ id: 'b', name: 'Broker B' }], quantity: '3', invested: '300', realizedGain: '13' })
  })

  it('keeps a symbol that every account has sold, with nothing held and no account named', () => {
    const [position] = combinePositions([held('a', 'X', { quantity: '0', invested: '0', averageCost: '0', realizedGain: '7' })])
    expect(position).toEqual({ symbol: 'X', accounts: [], status: 'calculated', currency: 'EUR', quantity: '0', invested: '0', averageCost: '0', realizedGain: '7' })
  })

  it('sums the USD cost basis only when every account bought in USD', () => {
    expect(combinePositions([held('a', 'X', { nativeInvested: '100' }), held('b', 'X', { nativeInvested: '50.5' })])[0]).toMatchObject({ nativeInvested: '150.5' })
    expect(combinePositions([held('a', 'X', { nativeInvested: '100' }), held('b', 'X')])[0]).not.toHaveProperty('nativeInvested')
    expect(combinePositions([held('a', 'X')])[0]).not.toHaveProperty('nativeInvested')
  })

  it('leaves out excluded accounts, and a symbol held only there', () => {
    const result = combinePositions([held('a', 'X'), held('b', 'X', { isExcluded: true, quantity: '99', invested: '9900' }), held('c', 'Y', { isExcluded: true })])
    expect(result.map((position) => position.symbol)).toEqual(['X'])
    expect(result[0]).toMatchObject({ accounts: [{ id: 'a', name: 'Broker A' }], quantity: '10' })
  })

  it('asks for historical FX when any account needs it, instead of adding up a partial figure', () => {
    const [position] = combinePositions([held('a', 'X'), fxRequired('b', 'X')])
    expect(position).toEqual({ symbol: 'X', accounts: [{ id: 'a', name: 'Broker A' }, { id: 'b', name: 'Broker B' }], status: 'historical-fx-required' })
  })

  it('does not add up positions in different currencies', () => {
    expect(combinePositions([held('a', 'X', { currency: 'EUR' }), held('b', 'X', { currency: 'USD' })])[0]).toMatchObject({ status: 'historical-fx-required' })
  })

  it('returns one position per symbol, in symbol order', () => {
    const result = combinePositions([held('b', 'C'), held('a', 'B'), held('b', 'A'), held('a', 'C')])
    expect(result.map((position) => position.symbol)).toEqual(['A', 'B', 'C'])
    expect(result[2]).toMatchObject({ quantity: '20' })
  })

  it('leaves a symbol held in one account as that account reports it', () => {
    expect(combinePositions([held('a', 'X', { quantity: '2.5', invested: '25', averageCost: '10', realizedGain: '1.5' })])[0]).toEqual({
      symbol: 'X', accounts: [{ id: 'a', name: 'Broker A' }], status: 'calculated', currency: 'EUR', quantity: '2.5', invested: '25', averageCost: '10', realizedGain: '1.5',
    })
  })

  it('keeps fractional quantities exact', () => {
    expect(combinePositions([held('a', 'X', { quantity: '0.1', invested: '1' }), held('b', 'X', { quantity: '0.2', invested: '2' })])[0]).toMatchObject({ quantity: '0.3', invested: '3', averageCost: '10' })
  })
})
