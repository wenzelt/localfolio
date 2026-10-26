import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard, LoginForm } from './dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const report = {
  period: 'MAX' as const, from: '2025-01-01', to: '2026-01-01', value: '1234.5', change: '100', changePercent: '12.5',
  series: [{ date: '2025-01-01', value: '1000', changePercent: '0' }, { date: '2026-01-01', value: '1234.5', changePercent: '12.5' }],
  unpriced: ['MISSING'],
  freshness: { pricesThrough: '2025-12-31', ratesThrough: null, stale: [] as ('prices' | 'fx')[], fetchedAt: '2026-01-01T09:30:00.000Z' as string | null },
}

describe('dashboard rendering', () => {
  it('shows value, return, dates, an accessible chart and all five chart period choices', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    for (const text of ['€1,234.50', '+12.50%', '€100.00', '2025-01-01', '2026-01-01', 'Portfolio performance', '1 positions unpriced', 'MISSING']) expect(html).toContain(text)
    expect(html).toContain('role="img"')
    expect(html).toContain('name="period"')
    expect(html.match(/<option /g)).toHaveLength(5)
    expect(html).toContain('action="/logout"')
  })

  it('masks monetary figures but retains dates and percentages in hide mode', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} hidden />)
    expect(html).not.toContain('€1,234.50')
    expect(html).not.toContain('€100.00')
    expect(html).toContain('+12.50%')
    expect(html).toContain('2025-01-01')
    expect(html).toContain('aria-label="Value hidden"')
    expect(html).toContain('Show values')
    expect(html).toContain('href="/?period=MAX&amp;hide=0"')
  })

  it('offers a URL-backed hide toggle retaining the timeframe', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, period: 'YTD' }} />)
    expect(html).toContain('Hide values')
    expect(html).toContain('href="/?period=YTD&amp;hide=1"')
  })

  it('shows a scoped heading, quantity, cost basis and back link', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} position={{
      accountId: 'broker', accountName: 'Broker', symbol: 'EXAMPLE', isExcluded: false, status: 'calculated', quantity: '2', averageCost: '10', invested: '20', realizedGain: '0', currency: 'EUR',
    }} />)
    expect(html).toContain('<h1>EXAMPLE</h1>')
    expect(html).toContain('Broker')
    expect(html).toContain('Quantity')
    expect(html).toContain('€20.00')
    expect(html).toContain('Back to portfolio')
    expect(html).toContain('account=broker&amp;symbol=EXAMPLE&amp;period=MAX&amp;hide=1')
  })

  it('masks quantity and cost basis in the detail view when values are hidden', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} hidden position={{
      accountId: 'broker', accountName: 'Broker', symbol: 'EXAMPLE', isExcluded: false, status: 'calculated', quantity: '2', averageCost: '10', invested: '20', realizedGain: '0', currency: 'EUR',
    }} />)
    expect(html).toContain('Quantity')
    expect(html).not.toContain('€20.00')
    expect(html).not.toMatch(/<dd>2<\/dd>/)
  })

  describe('native USD figures', () => {
    const usdReport = { ...report, series: [...report.series.slice(0, 1),
      { ...report.series[1], price: { close: '90.5', currency: 'USD' as const, date: '2026-01-01' } }] }
    const usdPosition = { accountId: 'broker', accountName: 'Broker', symbol: 'EXAMPLE', isExcluded: false, status: 'calculated' as const,
      quantity: '2', averageCost: '90', invested: '162', realizedGain: '0', currency: 'EUR' as const, nativeInvested: '180' }

    it('shows the USD cost basis and USD market value next to the EUR figures', () => {
      const html = renderToStaticMarkup(<Dashboard report={usdReport} position={usdPosition} />)
      expect(html).toContain('Cost basis · EUR')
      expect(html).toContain('€162.00')
      expect(html).toContain('Cost basis · USD')
      expect(html).toContain('$180.00')
      expect(html).toContain('Value · USD')
      expect(html).toContain('$181.00')
    })

    it('masks the USD figures when values are hidden', () => {
      const html = renderToStaticMarkup(<Dashboard report={usdReport} hidden position={usdPosition} />)
      expect(html).toContain('Cost basis · USD')
      expect(html).toContain('Value · USD')
      expect(html).not.toContain('$180.00')
      expect(html).not.toContain('$181.00')
    })

    it('shows no USD rows for a holding without a native USD cost basis', () => {
      const { nativeInvested: _unused, ...eurPosition } = usdPosition
      expect(renderToStaticMarkup(<Dashboard report={usdReport} position={eurPosition} />)).not.toContain('· USD')
    })

    it('shows the cost basis but no USD value when the latest observation has no USD close', () => {
      const html = renderToStaticMarkup(<Dashboard report={report} position={usdPosition} />)
      expect(html).toContain('$180.00')
      expect(html).not.toContain('Value · USD')
    })
  })

  it('explains that historical FX is required instead of showing figures for a mixed-currency position', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} position={{
      accountId: 'broker', accountName: 'Broker', symbol: 'MIXED', isExcluded: false, status: 'historical-fx-required',
    }} />)
    expect(html).toContain('Historical FX required to calculate this position.')
    expect(html).not.toContain('Quantity')
  })

  it('shows an empty state without an import', () => {
    expect(renderToStaticMarkup(<Dashboard report={null} />)).toContain('No portfolio imported')
  })

  it('refreshes itself on the overview and on a single position', () => {
    expect(renderToStaticMarkup(<Dashboard report={report} />)).toContain('data-live-refresh')
    expect(renderToStaticMarkup(<Dashboard report={null} />)).not.toContain('data-live-refresh')
  })

  it('names the next step when nothing is imported', () => {
    const html = renderToStaticMarkup(<Dashboard report={null} />)
    expect(html).toContain('npm run import:ghostfolio')
    expect(html).toContain('npm run ledger:add')
  })

  it('shows change and return as labelled figures next to the value', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toMatch(/<dt[^>]*>Change<\/dt><dd[^>]*>[^<]*€100\.00/)
    expect(html).toMatch(/<dt[^>]*>Return<\/dt><dd[^>]*>[^<]*\+12\.50%/)
  })

  describe('today’s portfolio movement', () => {
    const daily = [
      { accountId: 'a', accountName: 'Broker', symbol: 'AAA', value: '110', changePercent: '10', observedOn: '2026-10-21', previousOn: '2026-10-20' },
      { accountId: 'a', accountName: 'Broker', symbol: 'BBB', value: '95', changePercent: '-5', observedOn: '2026-10-21', previousOn: '2026-10-20' },
    ]

    it('shows today’s EUR change and percentage with its date, whatever chart timeframe is selected', () => {
      const html = renderToStaticMarkup(<Dashboard report={{ ...report, period: 'MAX' }} daily={daily} />)
      expect(html).toMatch(/<dt[^>]*>Today · 2026-10-21<\/dt><dd[^>]*>[^<]*€5\.00[^<]*\+2\.50%/)
    })

    it('says how many holdings are still on an earlier session than the one dated', () => {
      const mixed = [{ ...daily[0], observedOn: '2026-10-26' }, { ...daily[1], observedOn: '2026-10-23' }]
      const html = renderToStaticMarkup(<Dashboard report={report} daily={mixed} />)
      expect(html).toContain('Today · 2026-10-26')
      expect(html).toContain('1 holding still on 2026-10-23 or earlier')
      expect(renderToStaticMarkup(<Dashboard report={report} daily={daily} />)).not.toContain('still on')
    })

    it('masks the amount but keeps the percentage in hide mode', () => {
      const html = renderToStaticMarkup(<Dashboard report={report} daily={daily} hidden />)
      expect(html).toMatch(/<dt[^>]*>Today · 2026-10-21<\/dt>/)
      expect(html).toContain('+2.50%')
      expect(html).not.toContain('€5.00')
    })

    it('is not shown when there are no positions', () => {
      expect(renderToStaticMarkup(<Dashboard report={report} />)).not.toContain('Today ·')
    })
  })

  it('draws an area under the line, a labelled zero baseline and an end marker', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toContain('class="area"')
    expect(html).toContain('class="marker"')
    expect(html).toMatch(/<text[^>]*>0%<\/text>/)
  })

  it('draws no area or marker without enough history', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, series: [] }} />)
    expect(html).not.toContain('class="area"')
    expect(html).not.toContain('class="marker"')
  })

  it('announces data-quality notices as status messages', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, freshness: { pricesThrough: '2025-12-01', ratesThrough: null, stale: ['prices'], fetchedAt: null } }} />)
    expect(html.match(/<aside[^>]*role="status"/g)).toHaveLength(2)
  })

  it('shows negative and unavailable returns without a false warning', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, change: '-10', changePercent: null, series: [], unpriced: [] }} />)
    expect(html).toContain('negative')
    expect(html).toContain('-€10.00')
    expect(html).toContain('Not enough price history')
    expect(html).not.toContain('positions unpriced')
  })

  it('does not warn about stale data when data is current', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).not.toContain('out of date')
    expect(html).not.toContain('unavailable')
  })

  it('marks stale prices with the last price date', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, freshness: { pricesThrough: '2025-12-01', ratesThrough: null, stale: ['prices'], fetchedAt: null } }} />)
    expect(html).toContain('Prices are out of date')
    expect(html).toContain('2025-12-01')
  })

  it('marks stale FX with the last rate date', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, freshness: { pricesThrough: '2025-12-31', ratesThrough: '2025-11-30', stale: ['fx'], fetchedAt: null } }} />)
    expect(html).toContain('Exchange rates are out of date')
    expect(html).toContain('2025-11-30')
    expect(html).not.toContain('Prices are out of date')
  })

  it('marks missing prices and rates as unavailable', () => {
    const html = renderToStaticMarkup(<Dashboard report={{ ...report, freshness: { pricesThrough: null, ratesThrough: null, stale: ['prices', 'fx'], fetchedAt: null } }} />)
    expect(html).toContain('Prices are unavailable')
    expect(html).toContain('Exchange rates are unavailable')
  })

  it('renders a password form and generic login errors', () => {
    const html = renderToStaticMarkup(<LoginForm error />)
    expect(html).toContain('type="password"')
    expect(html).toContain('action="/login/submit"')
    expect(html).toContain('Incorrect password')
    expect(renderToStaticMarkup(<LoginForm error={false} />)).not.toContain('Incorrect password')
  })
})

 describe('daily movement integration', () => {
  it('places daily movement below the chart even for a longer chart timeframe', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toContain('Today’s movement')
    expect(html.indexOf('Today’s movement')).toBeGreaterThan(html.indexOf('Portfolio performance'))
  })
})

 describe('investment display names', () => {
  it('shows a readable name in the detail heading, retaining the symbol', () => {
    const position = { accountId: 'broker', accountName: 'Broker', symbol: 'CODE123', name: 'Synthetic World Equity', isExcluded: false, status: 'historical-fx-required' as const }
    const detail = renderToStaticMarkup(<Dashboard report={report} position={position} />)
    expect(detail).toContain('<h1>Synthetic World Equity</h1>')
    expect(detail).toContain('CODE123')
  })
})

describe('country overview', () => {
  it('shows geographic exposure below daily movement on the overview', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toContain('Country exposure')
    expect(html.indexOf('Country exposure')).toBeGreaterThan(html.indexOf('Today’s movement'))
  })
})

describe('wide screens', () => {
  it('puts movement and country cards in one panels group that becomes two columns on wide screens', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toMatch(/<div class="panels"><section class="card daily-movement"[\s\S]*<section class="card country-exposure"[\s\S]*<\/section><\/div>/)
    const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(min-width: 1100px\) \{[^@]*main \{ max-width: 1200px/)
    expect(css).toMatch(/@media \(min-width: 1100px\) \{[^@]*\.panels \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  })
})

describe('single list of positions', () => {
  it('relies on the movement list instead of repeating a Positions section below it', () => {
    const daily = [{ accountId: 'broker', accountName: 'Broker', symbol: 'OPEN', name: 'Synthetic Open Fund', value: '200', changePercent: '1', observedOn: '2026-10-21', previousOn: '2026-10-20' }]
    const html = renderToStaticMarkup(<Dashboard report={report} daily={daily} />)
    expect(html).not.toContain('<h2>Positions</h2>')
    expect(html).toContain('account=broker&amp;symbol=OPEN&amp;period=MAX&amp;hide=0')
    expect(html).toContain('Synthetic Open Fund')
  })
})

describe('app shell and privacy toggle', () => {
  const toggle = (html: string) => html.match(/<a [^>]*class="privacy-toggle"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''

  it('presents the toggle as a labelled control with an icon, not as a bare text link', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(toggle(html)).toMatch(/^<a [^>]*href="\/\?period=MAX&amp;hide=1"[^>]*data-hidden="false"[^>]*><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*<\/svg><span>Hide values<\/span><\/a>$/)
  })

  it('shows the privacy state on the control itself while values are hidden', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} hidden />)
    expect(toggle(html)).toMatch(/data-hidden="true"[\s\S]*<span>Show values<\/span>/)
  })

  it('groups the account actions on the right of the bar and marks the product', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toMatch(/<header><a [^>]*class="brand"[^>]*><svg [^>]*aria-hidden="true"[\s\S]*<\/svg><span>Localfolio<\/span><\/a><div class="actions">[\s\S]*privacy-toggle[\s\S]*action="\/logout"[\s\S]*<\/div><\/header>/)
  })

  it('sets every masked figure in one mask style so hidden values keep their width', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} hidden />)
    expect(html.match(/<span class="mask" role="img" aria-label="Value hidden">••••<\/span>/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).not.toMatch(/<span role="img" aria-label="Value hidden">/)
  })

  it('titles the screen first and puts the scope and freshness in a line under it', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html.indexOf('<h1>Your portfolio</h1>')).toBeGreaterThan(-1)
    expect(html.indexOf('<h1>')).toBeLessThan(html.indexOf('Overview · EUR'))
    expect(html).not.toContain('class="eyebrow"')
  })

  it('leads the card with the answer figure beside its supporting figures', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toMatch(/<div class="summary"><div><p class="label">Net invested value<\/p><div class="value">€1,234\.50<\/div><\/div><dl class="stats">/)
  })
})

describe('interface styling contract', () => {
  const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')

  it('keeps the toggle a 44px target with visible focus and a distinct hidden state', () => {
    expect(css).toMatch(/\.privacy-toggle \{[^}]*min-height: 44px/)
    expect(css).toMatch(/\.privacy-toggle\[data-hidden="true"\] \{[^}]*background: var\(--accent\)/)
    expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid/)
  })

  it('drops motion for people who ask for less', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)')
    // only the loading spinner may loop: it exists solely while a timeframe change is pending
    expect(css.replace(/\.spinner \{ animation: spin[^}]*\}/, '')).not.toMatch(/animation:[^;]*infinite/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.spinner \{ animation: spin 800ms linear infinite; \}/)
  })

  it('reserves a fixed slot for the loading spinner and dims the chart while pending', () => {
    expect(css).toMatch(/\.period-status \{[^}]*width: 18px; height: 18px/)
    expect(css).toMatch(/main:has\(\.period\[aria-busy="true"\]\) \.chart \{ opacity/)
  })

  it('does not paint with gradients or resting shadows', () => {
    expect(css).not.toMatch(/gradient\(/)
    expect(css).not.toMatch(/box-shadow: (?!none)/)
  })
})

describe('entry points for adding a buy', () => {
  const holding = { accountId: 'broker 1', accountName: 'Broker', symbol: 'VWCE.DE', isExcluded: false, status: 'calculated' as const, quantity: '2', averageCost: '10', invested: '20', realizedGain: '0', currency: 'EUR' }

  it('offers an Add buy link in the header of the overview', () => {
    expect(renderToStaticMarkup(<Dashboard report={report} />)).toContain('<a class="quiet add-buy" href="/buy">Add buy</a>')
  })

  it('offers an Add buy link on the empty state too', () => {
    expect(renderToStaticMarkup(<Dashboard report={null} />)).toContain('href="/buy"')
  })

  it('repeats the link under the heading for phones, where the header bar has no room for it', () => {
    expect(renderToStaticMarkup(<Dashboard report={report} />)).toContain('<a class="quiet buy-more overview-buy" href="/buy">Add buy</a>')
    expect(renderToStaticMarkup(<Dashboard report={report} position={holding} />)).not.toContain('overview-buy')
  })

  it('offers to increase a position, with the account and symbol already chosen', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} position={holding} />)
    expect(html).toContain('href="/buy?account=broker%201&amp;symbol=VWCE.DE"')
    expect(html).toContain('Buy more')
  })
})
