import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './dashboard'
import { ThemePicker } from './theme-picker'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const report = {
  period: 'MAX' as const, from: '2025-01-01', to: '2026-01-01', value: '1234.5', change: '100', changePercent: '12.5',
  series: [{ date: '2025-01-01', value: '1000', changePercent: '0' }, { date: '2026-01-01', value: '1234.5', changePercent: '12.5' }],
  unpriced: [] as string[],
  freshness: { pricesThrough: '2025-12-31', ratesThrough: null, stale: [] as ('prices' | 'fx')[], fetchedAt: null as string | null },
}

const buttons = (html: string) => [...html.matchAll(/<button [^>]*name="theme"[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0])

describe('theme picker', () => {
  it('opens from a labelled summary, so it works without script and names the control', () => {
    const html = renderToStaticMarkup(<ThemePicker theme="ledger" />)
    expect(html).toMatch(/^<details class="theme-picker"><summary [^>]*aria-label="Theme"[^>]*>[\s\S]*<\/summary>/)
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/)
  })

  it('posts the chosen theme to the server, one submit button per theme', () => {
    const html = renderToStaticMarkup(<ThemePicker theme="ledger" />)
    expect(html).toContain('<form action="/theme" method="post">')
    const choices = buttons(html)
    expect(choices).toHaveLength(3)
    expect(choices[0]).toMatch(/type="submit"[^>]*value="ledger"|value="ledger"[^>]*type="submit"/)
    expect(choices[0]).toContain('Ledger')
    expect(choices[1]).toMatch(/value="vaporwave"/)
    expect(choices[1]).toContain('Vaporwave')
    expect(choices[2]).toMatch(/value="popart"/)
    expect(choices[2]).toContain('Pop Art')
    expect(choices[2]).toMatch(/data-swatch="popart"/)
  })

  it('marks only the active theme as current', () => {
    const [ledger, vaporwave] = buttons(renderToStaticMarkup(<ThemePicker theme="vaporwave" />))
    expect(vaporwave).toContain('aria-current="true"')
    expect(ledger).not.toContain('aria-current')
  })

  it('marks the pop art parody as current when it is the saved theme', () => {
    const [ledger, vaporwave, popart] = buttons(renderToStaticMarkup(<ThemePicker theme="popart" />))
    expect(popart).toContain('aria-current="true"')
    expect(ledger + vaporwave).not.toContain('aria-current')
  })
})

describe('theme picker in the app shell', () => {
  it('sits in the header actions between the privacy toggle and log out', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} />)
    expect(html).toMatch(/class="actions">[\s\S]*privacy-toggle[\s\S]*class="theme-picker"[\s\S]*action="\/logout"/)
  })

  it('passes the active theme to the picker', () => {
    const html = renderToStaticMarkup(<Dashboard report={report} theme="vaporwave" />)
    expect(buttons(html)[1]).toContain('aria-current="true"')
  })
})
