import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './dashboard'
import { HairCrest, HairPattern, HairSticker, HairSwoop } from './hair'

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
const note = 'Independent satire. Not affiliated with or endorsed by Donald Trump or any political campaign.'

describe('hair motifs', () => {
  it('are decorative: hidden from assistive technology and never focusable', () => {
    for (const html of [renderToStaticMarkup(<HairSwoop />), renderToStaticMarkup(<HairSticker label="Big hair energy" />), renderToStaticMarkup(<HairCrest>Big hair energy</HairCrest>), renderToStaticMarkup(<HairPattern />)]) {
      expect(html).toMatch(/aria-hidden="true"/)
      expect(html).toMatch(/focusable="false"|^<span|^<div/)
      expect(html).not.toMatch(/<(a|button|input)\b|tabindex/)
    }
  })

  it('share one construction: thick ink outline and two flat golds taken from the theme tokens', () => {
    const svg = renderToStaticMarkup(<HairSwoop />)
    expect(svg).toContain('stroke="var(--pop-ink)"')
    expect(svg).toContain('fill="var(--pop-gold)"')
    expect(svg).toContain('fill="var(--pop-gold-shadow)"')
    expect(svg).not.toMatch(/Gradient/i)
    expect(svg).toMatch(/stroke-width="var\(--pop-outline\)"|strokeWidth/i)
  })

  it('reuse the swoop: the sticker and the crest each carry one, the pattern tiles it', () => {
    expect(renderToStaticMarkup(<HairSticker label="Comb-over edition" />)).toMatch(/class="hair-sticker"[\s\S]*<svg[\s\S]*Comb-over edition/)
    expect(renderToStaticMarkup(<HairCrest>Big hair energy</HairCrest>)).toMatch(/class="hair-crest"[\s\S]*<svg[\s\S]*class="bubble"[^>]*>Big hair energy/)
    expect(renderToStaticMarkup(<HairPattern />)).toMatch(/<pattern /)
  })
})

describe('dashboard in the pop art parody theme', () => {
  const html = renderToStaticMarkup(<Dashboard report={report} theme="popart" />)

  it('crowns the page with one decorative banner holding the dominant hair, hidden from assistive technology', () => {
    expect(html).toMatch(/<section class="pop-banner" aria-hidden="true">[\s\S]*<svg[\s\S]*<\/section>/)
    expect(html.match(/class="pop-banner"/g)).toHaveLength(1)
    expect(html.indexOf('pop-banner')).toBeLessThan(html.indexOf('<h1'))
  })

  it('perches a sticker on the summary card and swaps the brand mark for the hair emblem', () => {
    expect(html).toMatch(/<section class="card"><span class="hair-sticker"/)
    expect(html).toMatch(/class="brand"><svg class="mark hair-mark"/)
  })

  it('states the parody in plain text, as a real note and not as decoration', () => {
    expect(html).toMatch(new RegExp(`<footer class="satire"[^>]*>[\\s\\S]*<p>${note}</p>`))
  })

  it('leaves every figure, heading and control as it was', () => {
    for (const text of ['Your portfolio', 'Net invested value', '€1,234.50', 'Log out', 'Hide values']) expect(html, text).toContain(text)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(/class="privacy-toggle"/)
    expect(html).toMatch(/class="period"/)
  })

  it('draws the hair emblem in the empty state and the parody note even without a portfolio', () => {
    const empty = renderToStaticMarkup(<Dashboard report={null as never} theme="popart" />)
    expect(empty).toMatch(/class="hair-empty"/)
    expect(empty).toContain(note)
  })

  it('adds nothing in the ledger or vaporwave themes', () => {
    for (const theme of ['ledger', 'vaporwave'] as const) {
      const other = renderToStaticMarkup(<Dashboard report={report} theme={theme} />)
      expect(other, theme).not.toMatch(/hair-|pop-banner|satire/)
    }
  })
})
