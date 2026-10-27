import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PositionsImportView } from './positions-import-view'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('the import positions page', () => {
  const html = renderToStaticMarkup(<PositionsImportView />)

  it('uses the same branded header and back link as the buy page', () => {
    expect(html).toContain('<a href="/" class="brand"><span>Localfolio</span></a>')
    expect(html).toMatch(/<div class="actions"><a class="back" href="\/">Back to portfolio<\/a><\/div>/)
  })

  it('is a constrained card with a labelled file field and a short rules list', () => {
    expect(html).toContain('class="card import"')
    expect(html).toMatch(/<div class="field"><label for="positions-file">Positions CSV<\/label>/)
    expect(html).toContain('<ul class="rules">')
    expect(html).toContain('Download CSV template')
  })

  it('keeps the wording the flow relies on', () => {
    expect(html).toContain('earlier performance')
    expect(html).toContain('Preview import')
  })

  it('styles the import card, rules and preview table', () => {
    const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.import-form\b/)
    expect(css).toMatch(/\.rules\b/)
    expect(css).toMatch(/\.preview table/)
  })
})
