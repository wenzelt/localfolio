import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImportPreview, PositionsImportView } from './positions-import-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const rows = [
  { line: 2, account: 'Broker', symbol: 'VWCE.DE', quantity: '12.5', averagePrice: '100.25', currency: 'EUR', date: '2026-01-02' },
  { line: 3, account: 'US account', symbol: 'AAPL', quantity: '3', averagePrice: '190', currency: 'USD', date: '2026-02-03' },
]

describe('the import positions page', () => {
  const html = renderToStaticMarkup(<PositionsImportView />)

  it('uses the same shell as the other pages', () => {
    expect(html).toContain('<span>Localfolio</span>')
    expect(html).toMatch(/<div class="actions"><a class="back" href="\/">Back to portfolio<\/a><\/div>/)
  })

  it('keeps the header inside main so it shares the page width and gutters', () => {
    expect(html).toMatch(/^<main><header>.*<\/header><section class="card import">.*<\/section><\/main>$/)
  })

  it('is one card with a heading, a short summary and the rules as a list', () => {
    expect(html).toMatch(/<section class="card import">/)
    expect(html).toContain('<h1>Import positions</h1>')
    expect(html).toMatch(/<ul class="rules">(<li>.*?<\/li>){4,}<\/ul>/)
    expect(html.match(/<p>/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('keeps the guidance the importer depends on', () => {
    for (const text of ['opening buys', 'earlier performance', 'No cash is moved', 'Yahoo tickers', 'EUR and USD', 'YYYY-MM-DD', '1000 rows', '1 MiB', 'exact name', 'Identical buys are skipped', 'verify tickers'])
      expect(html).toContain(text)
  })

  it('offers the template as a download and the file as a labelled field', () => {
    expect(html).toMatch(/<a[^>]*class="quiet"[^>]*download="positions-template.csv"[^>]*>Download CSV template<\/a>|<a[^>]*download="positions-template.csv"[^>]*class="quiet"[^>]*>Download CSV template<\/a>/)
    expect(html).toMatch(/<form class="import-form">.*<label for="positions-file">Positions CSV<\/label>.*<input[^>]*id="positions-file"[^>]*type="file"/)
    expect(html).toMatch(/<button type="submit" class="primary">Preview import<\/button>/)
  })

  it('shows no preview before a file is chosen', () => {
    expect(html).not.toContain('Import preview')
  })
})

describe('the import preview', () => {
  const html = renderToStaticMarkup(<ImportPreview rows={rows} busy={false} onConfirm={() => {}} onCancel={() => {}} />)

  it('scrolls the table sideways inside its own wrapper instead of stretching the page', () => {
    expect(html).toMatch(/<div class="table-scroll"><table class="import-table">/)
  })

  it('right-aligns the numeric columns and keeps the text columns left-aligned', () => {
    expect(html).toContain('<th class="num">Quantity</th>')
    expect(html).toContain('<th class="num">Average price</th>')
    expect(html).toContain('<td class="num">12.5</td>')
    expect(html).toContain('<td class="num">100.25</td>')
    expect(html).toContain('<th>Account</th>')
    expect(html).toContain('<td>Broker</td>')
  })

  it('counts positions and keeps the confirm copy', () => {
    expect(html).toContain('Preview: 2 positions')
    expect(html).toContain('Invalid imports save nothing')
  })

  it('makes confirm the primary action and cancel the quiet one, disabled while busy', () => {
    expect(html).toMatch(/<button type="button" class="primary">Confirm import<\/button>/)
    expect(html).toMatch(/<button type="button" class="quiet">Cancel<\/button>/)
    const busy = renderToStaticMarkup(<ImportPreview rows={rows} busy onConfirm={() => {}} onCancel={() => {}} />)
    expect(busy.match(/disabled=""/g)).toHaveLength(2)
  })
})
