import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CountryMap } from './country-map'

const compositions = { FUND: { weights: { Germany: '25', 'United States': '50' }, source: 'https://example.org/fund', asOf: '2026-09-30' } }
const positions = [{ symbol: 'FUND', value: '100' }]

describe('country exposure map', () => {
  it('shows a world outline, country shares and a separate grey unknown share', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={compositions} />)
    expect(html).toContain('<svg')
    expect(html).toContain('Germany: 25.00%')
    expect(html).toContain('United States: 50.00%')
    expect(html).toContain('Other / not broken down')
    expect(html).toContain('25.00%')
    expect(html).toContain('€25.00')
    expect(html).toContain('country-unknown')
    expect(html).toContain('2026-09-30')
    expect(html).toContain('Source dates are not live')
    expect(html).toContain('https://example.org/fund')
  })
  it('says a fund can be read from the countries of its largest holdings, not only from reported weights', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={compositions} />)
    expect(html).toContain('Funds: reported country weights or the countries of their largest holdings')
    expect(html).toContain('not revenue exposure')
  })
  it('labels allocated countries without a map shape instead of silently omitting them', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={{
      FUND: { weights: { Singapore: '100' }, source: 'test', asOf: null },
    }} />)
    expect(html).toContain('Singapore (not shown on map)')
    expect(html).toContain('100.00%')
  })

  it('hides EUR amounts while retaining country percentages', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={compositions} hidden />)
    expect(html).not.toContain('€')
    expect(html).toContain('50.00%')
  })
  it('identifies priced holdings with missing or empty country weights', () => {
    const html = renderToStaticMarkup(<CountryMap positions={[...positions,
      { symbol: 'MISSING', value: '50' }, { symbol: 'EMPTY', value: '25' },
      { symbol: 'UNPRICED', value: null }]} compositions={{ ...compositions,
      EMPTY: { weights: {}, source: 'https://example.org/empty', asOf: '2026-09-30' } }} />)
    expect(html).toContain('MISSING · Country weights unavailable')
    expect(html).toContain('EMPTY · Country weights unavailable')
    expect(html).not.toContain('UNPRICED')
    expect(html).toContain('FUND · 2026-09-30')
  })

  it('flags old source dates and distinguishes them from recent fetches', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={{
      FUND: { ...compositions.FUND, asOf: '2000-01-01', fetchedAt: '2026-10-22T10:00:00.000Z' },
    }} />)
    expect(html).toContain('Stale country weights')
    expect(html).toContain('Last fetched: 2026-10-22')
    expect(html).toContain('2000-01-01')
    expect(html).toContain('90 days')
  })

  it('shows weight coverage per holding and says when 95 percent or more is scaled to 100 percent', () => {
    const partial = renderToStaticMarkup(<CountryMap positions={positions} compositions={compositions} />)
    expect(partial).toContain('Coverage: 75.00%')
    expect(partial).not.toContain('scaled to 100%')
    const nearlyComplete = renderToStaticMarkup(<CountryMap positions={positions} compositions={{ FUND: { ...compositions.FUND, weights: { Germany: '48', 'United States': '48' } } }} />)
    expect(nearlyComplete).toContain('Coverage: 96.00% · scaled to 100%')
    expect(nearlyComplete).toMatch(/Other \/ not broken down<\/span><span>0\.00%/)
  })

  it('labels unknown source and fetch dates explicitly', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={{ FUND: { ...compositions.FUND, asOf: null } }} />)
    expect(html).toContain('Freshness unknown')
    expect(html).toContain('Last fetched: unavailable')
  })

  it('labels missing dates and all-unknown or empty portfolios honestly', () => {
    const html = renderToStaticMarkup(<CountryMap positions={positions} compositions={{ FUND: { ...compositions.FUND, asOf: null } }} />)
    expect(html).toContain('Source date unavailable')
    expect(renderToStaticMarkup(<CountryMap positions={positions} compositions={{}} />)).toContain('100.00%')
    expect(renderToStaticMarkup(<CountryMap positions={[]} compositions={{}} />)).toContain('No priced open positions')
  })
})

describe('country exposure map with unusable stored weights', () => {
  const held = [{ symbol: 'GOOD', value: '100' }, { symbol: 'BAD', value: '100' }]
  const good = { weights: { Germany: '50' }, source: 'https://example.org/good', asOf: '2026-09-30' }
  const bad = (weights: unknown) => ({ weights: weights as Record<string, string>, source: 'https://example.org/bad', asOf: '2026-09-30' })
  const shapes: [string, unknown][] = [
    ['more than 100 percent', { Germany: '70', Japan: '40' }],
    ['a negative weight', { Germany: '-5' }],
    ['a word instead of a number', { Germany: 'many' }],
    ['a JSON number instead of text', { Germany: 50 }],
    ['null weights', null],
    ['a list instead of countries', ['Germany']],
    ['text instead of countries', 'Germany'],
  ]

  it('renders the rest of the panel and counts the unusable holding as not broken down', () => {
    const html = renderToStaticMarkup(<CountryMap positions={held} compositions={{ GOOD: good, BAD: bad({ Germany: '70', Japan: '40' }) }} />)
    expect(html).toContain('Germany: 25.00%')
    expect(html).toContain('Japan: No allocated exposure')
    expect(html).toMatch(/Other \/ not broken down<\/span><span>75\.00%/)
  })

  it('names the holding and the reason, in the list and in a visible warning', () => {
    const html = renderToStaticMarkup(<CountryMap positions={held} compositions={{ GOOD: good, BAD: bad({ Germany: '70', Japan: '40' }) }} />)
    expect(html).toContain('BAD · Country weights invalid')
    expect(html).toContain('more than 100%')
    expect(html).toMatch(/role="alert"[^>]*>Country weights for BAD are invalid/)
  })

  it('survives every unusable shape and still shows the good holding', () => {
    for (const [name, weights] of shapes) {
      const html = renderToStaticMarkup(<CountryMap positions={held} compositions={{ GOOD: good, BAD: bad(weights) }} />)
      expect(html, name).toContain('Germany: 25.00%')
      expect(html, name).toContain('BAD · Country weights invalid')
    }
  })

  it('warns once for several unusable holdings and lists each by name', () => {
    const html = renderToStaticMarkup(<CountryMap positions={[...held, { symbol: 'WORSE', value: '10' }]} compositions={{ GOOD: good, BAD: bad({ Germany: '101' }), WORSE: bad(null) }} />)
    expect(html.match(/role="alert"/g)).toHaveLength(1)
    expect(html).toContain('Country weights for BAD, WORSE are invalid')
  })

  it('does not warn about unusable weights for a symbol that is no longer held', () => {
    const html = renderToStaticMarkup(<CountryMap positions={[{ symbol: 'GOOD', value: '100' }]} compositions={{ GOOD: good, BAD: bad({ Germany: '101' }) }} />)
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('invalid')
  })

  it('shows no warning when every stored composition is usable', () => {
    expect(renderToStaticMarkup(<CountryMap positions={held} compositions={{ GOOD: good, BAD: good }} />)).not.toContain('role="alert"')
  })
})
