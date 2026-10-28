import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AccountsView } from './accounts-view'
import { BuyView } from './buy-view'
import { GhostfolioImportView } from './ghostfolio-import-view'
import { PositionsImportView } from './positions-import-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }))

const accounts = [{ id: 'acc-1', name: 'Broker', currency: 'EUR', comment: null, transactions: 1, positions: 1 }]

// The header must sit inside <main>, like the dashboard's, so it shares the page width and gutters
// instead of running edge to edge with its content centred beneath it.
describe.each([
  ['accounts', <AccountsView accounts={accounts} />],
  ['add buy', <BuyView accounts={accounts} today="2026-03-02" />],
  ['import positions', <PositionsImportView />],
  ['import Ghostfolio export', <GhostfolioImportView />],
])('the %s page', (_name, page) => {
  const html = renderToStaticMarkup(page)

  it('renders its header inside main', () => {
    expect(html).toMatch(/^<main><header>.*<\/header>/)
    expect(html).toMatch(/<\/main>$/)
    expect(html.match(/<header/g)).toHaveLength(1)
  })

  it('still links back to the portfolio', () => {
    expect(html).toContain('<a class="back" href="/">Back to portfolio</a>')
  })
})
