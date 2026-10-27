import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './dashboard'
import { GhostfolioImportView, importSummary } from './ghostfolio-import-view'
import { PositionsImportView } from './positions-import-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('the Ghostfolio export upload page', () => {
  const html = renderToStaticMarkup(<GhostfolioImportView />)

  it('uses the branded header, back link and a labelled JSON file field', () => {
    expect(html).toContain('<a href="/" class="brand"><span>Localfolio</span></a>')
    expect(html).toMatch(/<a class="back" href="\/">Back to portfolio<\/a>/)
    expect(html).toMatch(/<label for="ghostfolio-file">Ghostfolio export \(JSON\)<\/label>/)
    expect(html).toMatch(/<input[^>]*id="ghostfolio-file"[^>]*accept="[^"]*\.json/)
    expect(html).toContain('Import export')
  })

  it('explains that repeats are skipped and a bad file saves nothing', () => {
    expect(html).toMatch(/skipped/i)
    expect(html).toMatch(/nothing is saved/i)
  })

  it('summarises created, skipped and rejected counts', () => {
    const zero = { accounts: 0, balances: 0, tags: 0, activities: 0 }
    expect(importSummary({ created: { ...zero, accounts: 2, activities: 5 }, skipped: { ...zero, balances: 1 } }))
      .toBe('Created 2 accounts, 0 balances, 0 tags, 5 activities. Skipped 0 accounts, 1 balances, 0 tags, 0 activities. Rejected 0 records.')
  })
})

describe('the way to the Ghostfolio upload', () => {
  it('is linked from the positions import page and from the empty overview', () => {
    expect(renderToStaticMarkup(<PositionsImportView />)).toMatch(/<a[^>]*href="\/import\/ghostfolio"[^>]*>[^<]*Ghostfolio/)
    expect(renderToStaticMarkup(<Dashboard report={null} />)).toMatch(/<a[^>]*href="\/import\/ghostfolio"[^>]*>[^<]*Ghostfolio/)
  })
})
