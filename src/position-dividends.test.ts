import { describe, expect, it } from 'vitest'
import { positionReport } from './positions'
import type { LedgerAccount, LedgerActivity } from './ledger-store'

const account: LedgerAccount = {
  id: 'a1', externalId: null, name: 'Synthetic broker', currency: 'EUR', balance: '0',
  comment: null, isExcluded: false, balances: [],
}

function activity(overrides: Partial<LedgerActivity>): LedgerActivity {
  return { id: crypto.randomUUID(), accountId: 'a1', type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO',
    currency: 'EUR', quantity: '2', unitPrice: '10', fee: '0', date: '2026-01-02T10:00:00.000Z',
    comment: null, tags: [], ...overrides }
}

describe('position report with dividends', () => {
  it('counts a dividend on a held symbol as realised income', () => {
    const report = positionReport({ accounts: [account], activities: [
      activity({}),
      activity({ type: 'DIVIDEND', quantity: '1', unitPrice: '3', date: '2026-02-01T10:00:00.000Z' }),
    ] })

    expect(report).toEqual([
      { accountId: 'a1', accountName: 'Synthetic broker', isExcluded: false, symbol: 'EXAMPLE',
        status: 'calculated', currency: 'EUR', quantity: '2', invested: '20', averageCost: '10', realizedGain: '3' },
    ])
  })

  it('does not create a position from a dividend without a symbol', () => {
    const report = positionReport({ accounts: [account], activities: [
      activity({ type: 'DIVIDEND', symbol: null, quantity: '1', unitPrice: '3' }),
    ] })

    expect(report).toEqual([])
  })
})
