import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BuyView } from './buy-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const accounts = [
  { id: 'acc-1', name: 'Brokerage', currency: 'EUR', comment: null },
  { id: 'acc-2', name: 'US account', currency: 'USD', comment: null },
]

describe('the add buy page', () => {
  it('has a search box that behaves as an accessible combobox, closed at first', () => {
    const html = renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" />)
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).toMatch(/<label[^>]*for="buy-symbol"[^>]*>Symbol/)
  })

  it('lists every account and caps the date at today', () => {
    const html = renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" />)
    expect(html).toContain('Brokerage (EUR)')
    expect(html).toContain('US account (USD)')
    expect(html).toMatch(/<input[^>]*type="date"[^>]*max="2026-03-02"[^>]*value="2026-03-02"|<input[^>]*value="2026-03-02"[^>]*max="2026-03-02"/)
  })

  it('pre-selects the account and symbol when increasing a position', () => {
    const html = renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" account="acc-2" symbol="VWCE.DE" />)
    expect(html).toMatch(/<option value="acc-2" selected/)
    expect(html).toContain('value="VWCE.DE"')
  })

  it('ignores a pre-selected account that does not exist', () => {
    const html = renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" account="nope" />)
    expect(html).not.toMatch(/<option value="acc-\d"[^>]*selected/)
    expect(html).toContain('<option value="" selected="">Choose an account</option>')
  })

  it('keeps the header inside main so it shares the page width and gutters', () => {
    expect(renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" />)).toMatch(/^<main><header>.*<\/header><section class="card buy">.*<\/section><\/main>$/)
  })

  it('links back to the portfolio', () => {
    expect(renderToStaticMarkup(<BuyView accounts={accounts} today="2026-03-02" />)).toContain('href="/"')
  })

  it('explains how to create an account when there is none', () => {
    const html = renderToStaticMarkup(<BuyView accounts={[]} today="2026-03-02" />)
    expect(html).toContain('No account yet')
    expect(html).toContain('ledger:add -- account')
    expect(html).not.toContain('role="combobox"')
  })
})
