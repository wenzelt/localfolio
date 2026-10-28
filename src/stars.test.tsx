import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './dashboard'
import { StarCrest, StarMark, StarPattern, StarSticker } from './stars'

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

const decorative = [
  renderToStaticMarkup(<StarMark />),
  renderToStaticMarkup(<StarSticker label="Stars & stripes" />),
  renderToStaticMarkup(<StarCrest>Home of the brave</StarCrest>),
  renderToStaticMarkup(<StarPattern />),
]

describe('star motifs', () => {
  it('are decorative: hidden from assistive technology and never focusable', () => {
    for (const html of decorative) {
      expect(html).toMatch(/aria-hidden="true"/)
      expect(html).toMatch(/focusable="false"|^<span|^<div/)
      expect(html).not.toMatch(/<(a|button|input)\b|tabindex/)
    }
  })

  it('share one construction: thick ink outline and two flat golds taken from the theme tokens', () => {
    const svg = renderToStaticMarkup(<StarMark />)
    expect(svg).toContain('stroke="var(--pop-ink)"')
    expect(svg).toContain('fill="var(--pop-gold)"')
    expect(svg).toContain('fill="var(--pop-gold-shadow)"')
    expect(svg).toMatch(/<polygon/)
    expect(svg).not.toMatch(/Gradient/i)
    expect(svg).toMatch(/stroke-width="var\(--pop-outline\)"|strokeWidth/i)
  })

  it('reuse the star: the sticker and the crest each carry one, the pattern tiles it', () => {
    expect(renderToStaticMarkup(<StarSticker label="Stars & stripes" />)).toMatch(/class="star-sticker"[\s\S]*<svg[\s\S]*Stars &amp; stripes/)
    expect(renderToStaticMarkup(<StarCrest>Home of the brave</StarCrest>)).toMatch(/class="star-crest"[\s\S]*<svg[\s\S]*class="bubble"[^>]*>Home of the brave/)
    expect(renderToStaticMarkup(<StarPattern />)).toMatch(/<pattern /)
  })
})

describe('dashboard in the pop art stars and stripes theme', () => {
  const html = renderToStaticMarkup(<Dashboard report={report} theme="popart" />)

  it('crowns the page with one decorative banner holding a flag and stars, hidden from assistive technology', () => {
    expect(html).toMatch(/<section class="pop-banner" aria-hidden="true">[\s\S]*<svg[\s\S]*<\/section>/)
    expect(html.match(/class="pop-banner"/g)).toHaveLength(1)
    expect(html.indexOf('pop-banner')).toBeLessThan(html.indexOf('<h1'))
    expect(html).toMatch(/class="star-flag"/)
    expect(html).toContain('Stars &amp; stripes edition')
  })

  it('perches a sticker on the summary card and swaps the brand mark for the star emblem', () => {
    expect(html).toMatch(/<section class="card"><span class="star-sticker"/)
    expect(html).toMatch(/class="brand"><svg class="mark star-mark"/)
  })

  it('closes with a decorative strip of stars and no disclaimer', () => {
    expect(html).toMatch(/<div class="star-footer"><svg class="star-pattern"[^>]*aria-hidden="true"/)
    expect(html).not.toMatch(/<footer class="satire"/)
  })

  it('refers to no real person, campaign or satire', () => {
    expect(html).not.toMatch(/satire|parody|trump|campaign|hair|comb-over|unprecedented|\bcap\b/i)
  })

  it('leaves every figure, heading and control as it was', () => {
    for (const text of ['Your portfolio', 'Net invested value', '€1,234.50', 'Log out', 'Hide values']) expect(html, text).toContain(text)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).toMatch(/class="privacy-toggle"/)
    expect(html).toMatch(/class="period"/)
  })

  it('draws the star emblem in the empty state', () => {
    const empty = renderToStaticMarkup(<Dashboard report={null as never} theme="popart" />)
    expect(empty).toMatch(/class="star-empty"/)
    expect(empty).not.toMatch(/satire|trump/i)
  })

  it('adds nothing in the ledger or vaporwave themes', () => {
    for (const theme of ['ledger', 'vaporwave'] as const) {
      const other = renderToStaticMarkup(<Dashboard report={report} theme={theme} />)
      expect(other, theme).not.toMatch(/star-|pop-banner/)
    }
  })
})
