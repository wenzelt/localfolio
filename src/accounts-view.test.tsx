import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AccountsView } from './accounts-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }))

const accounts = [
  { id: 'acc-1', name: 'Consors', currency: 'EUR', comment: 'Main depot', transactions: 11, positions: 5 },
  { id: 'acc-2', name: 'Fresh', currency: 'USD', comment: null, transactions: 0, positions: 0 },
  { id: 'acc-3', name: 'One', currency: 'EUR', comment: null, transactions: 1, positions: 1 },
]

describe('the accounts page', () => {
  it('has a heading and a way back to the portfolio', () => {
    const html = renderToStaticMarkup(<AccountsView accounts={accounts} />)
    expect(html).toMatch(/<h1>Accounts<\/h1>/)
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Back to portfolio<\/a>/)
  })

  it('lists each account with its currency, comment and activity counts', () => {
    const html = renderToStaticMarkup(<AccountsView accounts={accounts} />)
    expect(html).toContain('Consors')
    expect(html).toContain('Main depot')
    expect(html).toContain('EUR')
    expect(html).toContain('USD')
    expect(html).toContain('5 positions · 11 transactions')
    expect(html).toContain('No activity yet')
    expect(html).toContain('1 position · 1 transaction')
  })

  it('offers a delete button per account, named after the account', () => {
    const html = renderToStaticMarkup(<AccountsView accounts={accounts} />)
    expect(html.match(/Delete account/g)).toHaveLength(3)
    expect(html).toContain('aria-label="Delete account Consors"')
  })

  it('has an add form with a labelled name, a currency of EUR or USD and an optional comment', () => {
    const html = renderToStaticMarkup(<AccountsView accounts={accounts} />)
    expect(html).toMatch(/<label[^>]*>Name\b/)
    expect(html).toMatch(/<input[^>]*name="name"[^>]*required|<input[^>]*required[^>]*name="name"/)
    expect(html).toContain('<option value="EUR"')
    expect(html).toContain('<option value="USD"')
    expect(html).not.toContain('<option value="GBP"')
    expect(html).toMatch(/<label[^>]*>Comment/)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Add account<\/button>/)
  })

  it('still shows the add form when there are no accounts', () => {
    const html = renderToStaticMarkup(<AccountsView accounts={[]} />)
    expect(html).toContain('No accounts yet')
    expect(html).toContain('Add account')
    expect(html).not.toContain('Delete account')
  })
})
