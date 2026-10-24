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
