import { describe, expect, it } from 'vitest'
import { addTransaction, createAccount } from './ledger-entry'
import { cacheTables, withIsolatedDatabase } from './test-support/schema'
import { readValuationReport } from './valuation-report'

async function valuation(dividends: string[]) {
  return withIsolatedDatabase(async (client) => {
    const { id: accountId } = await createAccount(client, { name: 'Synthetic broker', currency: 'EUR' })
    await addTransaction(client, { accountId, type: 'BUY', date: '1980-01-02', currency: 'EUR', symbol: 'EXAMPLE', quantity: '2', unitPrice: '10' })
    for (const amount of dividends) {
      await addTransaction(client, { accountId, type: 'DIVIDEND', date: '1980-01-05', currency: 'EUR', symbol: 'EXAMPLE', amount })
    }
    await client.unsafe(cacheTables)
    await client`INSERT INTO security_quotes VALUES ('EXAMPLE', '1980-01-10', 15, 'EUR', 'yfinance', now())`
    return readValuationReport(client, '1980-01-10')
  })
}

describe('valuation report with dividends', () => {
  it('adds a dividend on a held symbol to the realised gain without changing quantity or market value', async () => {
    const [position] = await valuation(['3'])

    expect(position).toMatchObject({ status: 'valued', quantity: '2', marketValue: '30', realizedGain: '3' })
  })

  it('does not change a position that has no dividends', async () => {
    const [position] = await valuation([])

    expect(position).toMatchObject({ status: 'valued', quantity: '2', marketValue: '30', realizedGain: '0' })
  })
})
