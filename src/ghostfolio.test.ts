import { describe, expect, it } from 'vitest'
import { parseGhostfolioExport, parseGhostfolioJson } from './ghostfolio'

function fixture() {
  return {
    meta: { version: '0.0.1', date: '2026-01-02T12:00:00.000Z' },
    accounts: [{
      id: 'account-1', name: 'Example broker', currency: 'EUR', balance: 100,
      balances: [{ date: '2026-01-01T00:00:00.000Z', value: 100 }],
      comment: null, isExcluded: false, platformId: null,
    }],
    assetProfiles: [], platforms: [], tags: [{ id: 'tag-1', name: 'ETF' }],
    activities: [{
      accountId: 'account-1', type: 'BUY', symbol: 'EXAMPLE', dataSource: 'YAHOO',
      currency: 'USD', quantity: 2.8, unitPrice: 81, fee: 1.25,
      date: '2026-01-02T10:00:00.000Z', comment: 'Example purchase', tags: ['tag-1'],
    }],
    user: { settings: { currency: 'EUR', performanceCalculationType: 'ROAI' } },
  }
}

describe('parseGhostfolioJson', () => {
  it('decodes and validates exported JSON text', () => {
    expect(parseGhostfolioJson(JSON.stringify(fixture()))).toEqual(fixture())
  })

  it.each(['', '{', '{"accounts":', 'undefined'])('rejects malformed JSON %j', (input) => {
    expect(() => parseGhostfolioJson(input)).toThrow('Invalid Ghostfolio JSON')
  })

  it('preserves field-specific errors for syntactically valid but invalid exports', () => {
    const input = fixture()
    input.activities[0].quantity = -1
    expect(() => parseGhostfolioJson(JSON.stringify(input))).toThrow('activities[0].quantity')
  })

  it('rejects a JSON primitive through schema validation', () => {
    expect(() => parseGhostfolioJson('null')).toThrow('export')
  })
})

describe('parseGhostfolioExport', () => {
  it('preserves supported fields, independent currencies and fractional quantities', () => {
    const input = fixture()
    const result = parseGhostfolioExport(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    expect(result.accounts[0].currency).toBe('EUR')
    expect(result.activities[0].currency).toBe('USD')
    expect(result.activities[0].quantity).toBe(2.8)
  })

  it('accepts sells and empty balance histories', () => {
    const input = fixture()
    input.activities[0].type = 'SELL'
    input.accounts[0].balances = []
    expect(parseGhostfolioExport(input)).toEqual(input)
  })

  it('accepts empty portfolios', () => {
    const input = { ...fixture(), accounts: [], activities: [], tags: [] }
    expect(parseGhostfolioExport(input)).toEqual(input)
  })

  it.each([null, [], 'invalid'])('rejects invalid root %j', (input) => {
    expect(() => parseGhostfolioExport(input)).toThrow('export')
  })

  const invalidCases: [string, (input: ReturnType<typeof fixture>) => void][] = [
    ['meta.version', (x) => { x.meta.version = '99' }],
    ['meta.date', (x) => { x.meta.date = 'yesterday' }],
    ['accounts[1].id', (x) => { x.accounts.push({ ...x.accounts[0] }) }],
    ['accounts[0].name', (x) => { x.accounts[0].name = '' }],
    ['accounts[0].currency', (x) => { x.accounts[0].currency = 'GBP' }],
    ['accounts[0].balance', (x) => { x.accounts[0].balance = Infinity }],
    ['accounts[0].balances[0].date', (x) => { x.accounts[0].balances[0].date = '2026-02-30T00:00:00.000Z' }],
    ['accounts[0].balances[0].value', (x) => { x.accounts[0].balances[0].value = NaN }],
    ['activities[0].accountId', (x) => { x.activities[0].accountId = 'missing' }],
    ['activities[0].tags[0]', (x) => { x.activities[0].tags = ['missing'] }],
    ['activities[0].quantity', (x) => { x.activities[0].quantity = NaN }],
    ['activities[0].quantity', (x) => { x.activities[0].quantity = 0 }],
    ['activities[0].unitPrice', (x) => { x.activities[0].unitPrice = -1 }],
    ['activities[0].fee', (x) => { x.activities[0].fee = -1 }],
    ['activities[0].date', (x) => { x.activities[0].date = 'yesterday' }],
    ['activities[0].currency', (x) => { x.activities[0].currency = 'GBP' }],
    ['activities[0].type', (x) => { x.activities[0].type = 'UNKNOWN' }],
    ['activities[0].dataSource', (x) => { x.activities[0].dataSource = 'UNKNOWN' }],
    ['activities[0].symbol', (x) => { x.activities[0].symbol = '' }],
    ['tags[1].id', (x) => { x.tags.push({ ...x.tags[0] }) }],
    ['user.settings.currency', (x) => { x.user.settings.currency = 'USD' }],
  ]

  it.each(invalidCases)('rejects invalid %s', (path, mutate) => {
    const input = fixture()
    mutate(input)
    expect(() => parseGhostfolioExport(input)).toThrow(path)
  })
})
