import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type BuyFields, buyRequest, debounce, latestOnly, submitOutcome } from './buy-form-logic'

const fields: BuyFields = { accountId: 'acc-1', symbol: ' vwce.de ', date: '2026-03-02', quantity: '2.5', unitPrice: '101.20', currency: 'EUR', fee: '', comment: '' }

describe('building the buy request', () => {
  it('trims and upper-cases the symbol and leaves decimals as the strings typed', () => {
    expect(buyRequest(fields, '2026-03-02')).toEqual({ ok: true, body: { accountId: 'acc-1', symbol: 'VWCE.DE', date: '2026-03-02', quantity: '2.5', unitPrice: '101.20', currency: 'EUR' } })
  })

  it('sends the fee and comment only when they were filled in, and force only when asked', () => {
    const result = buyRequest({ ...fields, fee: '1.5', comment: ' monthly ' }, '2026-03-02', true)
    expect(result).toMatchObject({ ok: true, body: { fee: '1.5', comment: 'monthly', force: true } })
    expect(buyRequest(fields, '2026-03-02')).not.toHaveProperty('body.force')
  })

  it('accepts a comma as the decimal separator', () => {
    expect(buyRequest({ ...fields, quantity: '2,5', unitPrice: '101,2' }, '2026-03-02')).toMatchObject({ ok: true, body: { quantity: '2.5', unitPrice: '101.2' } })
  })

  it.each([
    [{ accountId: '' }, 'Choose an account'],
    [{ symbol: '  ' }, 'Search for a symbol and pick it from the list'],
    [{ date: '' }, 'Enter the date of the purchase'],
    [{ date: '2026-03-03' }, 'A buy cannot be dated in the future'],
    [{ quantity: '' }, 'Enter a quantity greater than zero'],
    [{ quantity: '0' }, 'Enter a quantity greater than zero'],
    [{ quantity: '-1' }, 'Enter a quantity greater than zero'],
    [{ quantity: '1e3' }, 'Enter a quantity greater than zero'],
    [{ unitPrice: '' }, 'Enter the price per unit'],
    [{ unitPrice: 'abc' }, 'Enter the price per unit'],
    [{ unitPrice: '-3' }, 'Enter the price per unit'],
    [{ fee: 'x' }, 'Enter the fee as a number, or leave it empty'],
    [{ currency: 'GBP' }, 'Only EUR and USD can be recorded'],
  ])('rejects %j with a readable message', (change, error) => {
    expect(buyRequest({ ...fields, ...change }, '2026-03-02')).toEqual({ ok: false, error })
  })
})

describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('runs once with the last arguments after the pause', () => {
    const run = vi.fn()
    const search = debounce(run, 250)
    search('v')
    vi.advanceTimersByTime(200)
    search('vw')
    vi.advanceTimersByTime(249)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledExactlyOnceWith('vw')
  })

  it('can be cancelled, as when the component goes away', () => {
    const run = vi.fn()
    const search = debounce(run, 250)
    search('v')
    search.cancel()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('keeping only the newest answer', () => {
  it('treats an older request as stale once a newer one starts', () => {
    const latest = latestOnly()
    const first = latest()
    expect(first()).toBe(true)
    const second = latest()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })
})

describe('reading the buy response', () => {
  it('reports a saved buy and whether it already has a price', () => {
    expect(submitOutcome(201, { id: 'x', priced: true })).toEqual({ kind: 'saved', priced: true })
    expect(submitOutcome(201, { id: 'x', priced: false })).toEqual({ kind: 'saved', priced: false })
  })

  it('offers to save anyway on a duplicate', () => {
    expect(submitOutcome(409, { error: 'Duplicate transaction: …', duplicate: true })).toEqual({ kind: 'duplicate', message: 'An identical buy is already saved.' })
  })

  it('shows the server message for a rejected buy', () => {
    expect(submitOutcome(400, { error: 'ZZZZ was not found on Yahoo Finance' })).toEqual({ kind: 'error', message: 'ZZZZ was not found on Yahoo Finance' })
    expect(submitOutcome(401, { error: 'Not signed in' })).toEqual({ kind: 'error', message: 'Your session has ended. Sign in again.' })
  })

  it('falls back to a generic message when the body is not what was promised', () => {
    expect(submitOutcome(500, null)).toEqual({ kind: 'error', message: 'The buy could not be saved' })
    expect(submitOutcome(502, 'oops')).toEqual({ kind: 'error', message: 'The buy could not be saved' })
  })
})
