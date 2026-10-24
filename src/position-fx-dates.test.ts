import { describe, expect, it } from 'vitest'
import { usdRateDatesOf } from './fx-cache'
import type { LedgerActivity } from './ledger-store'

function activity(overrides: Partial<LedgerActivity>): LedgerActivity {
  return { id: crypto.randomUUID(), accountId: 'a1', type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO',
    currency: 'USD', quantity: '2', unitPrice: '10', fee: '0', date: '2026-01-02T10:00:00.000Z',
    comment: null, tags: [], ...overrides }
}

describe('historical USD/EUR rate dates for the position report', () => {
  it('includes the date of a USD dividend on a held symbol so its position is not left without a rate', () => {
    expect(usdRateDatesOf([
      activity({}),
      activity({ type: 'DIVIDEND', quantity: '1', unitPrice: '3', date: '2026-02-01T10:00:00.000Z' }),
    ])).toEqual(['2026-01-02', '2026-02-01'])
  })

  it('ignores EUR activities, USD cash movements without a symbol, and repeated dates', () => {
    expect(usdRateDatesOf([
      activity({}),
      activity({ type: 'SELL', date: '2026-01-02T15:00:00.000Z' }),
      activity({ currency: 'EUR', date: '2026-03-01T10:00:00.000Z' }),
      activity({ type: 'DEPOSIT', symbol: null, date: '2026-04-01T10:00:00.000Z' }),
    ])).toEqual(['2026-01-02'])
  })
})
