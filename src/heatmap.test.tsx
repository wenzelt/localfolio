import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DailyHeatmap, tileLayout, movementIntensity } from './heatmap'

const items = [
  { accountId: 'a', accountName: 'Broker', symbol: 'GAIN', value: '300', changePercent: '2', observedOn: '2026-10-21', previousOn: '2026-10-20' },
  { accountId: 'b', accountName: 'Other', symbol: 'LOSS', value: '100', changePercent: '-1', observedOn: '2026-10-20', previousOn: '2026-10-19' },
]

describe('weighted tile layout', () => {
  it('allocates exact proportional areas inside the unit rectangle', () => {
    const tiles = tileLayout(items)
    expect(tiles).toHaveLength(2)
    expect(tiles[0].width * tiles[0].height).toBeCloseTo(0.75)
    expect(tiles[1].width * tiles[1].height).toBeCloseTo(0.25)
    for (const tile of tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(1)
      expect(tile.y + tile.height).toBeLessThanOrEqual(1)
    }
  })
  it('keeps unavailable and zero valuations out of the map without losing their list entries', () => {
    expect(tileLayout([{ ...items[0], value: null }, { ...items[1], value: '0' }])).toEqual([])
  })
  it('uses a fixed capped percentage colour scale', () => {
    expect(movementIntensity('5')).toBe(1)
    expect(movementIntensity('-10')).toBe(1)
    expect(movementIntensity('1')).toBeCloseTo(0.2)
    expect(movementIntensity(null)).toBe(0)
    expect(movementIntensity('0')).toBe(0)
  })
})

describe('daily heatmap', () => {
  it('links every position, names its account and session, and explains size and colour', () => {
    const html = renderToStaticMarkup(<DailyHeatmap items={items} period="MAX" hidden={false} />)
    expect(html).toContain('Today’s movement')
    expect(html).toContain('quoted currency')
    expect(html).toContain('2026-10-20')
    expect(html).toContain('Broker')
    expect(html).toContain('account=a&amp;symbol=GAIN')
    expect(html).toContain('+2.00%')
    expect(html).toContain('-1.00%')
    expect(html).toContain('€300.00')
  })
  it('hides monetary values without hiding percentages and preserves privacy in links', () => {
    const html = renderToStaticMarkup(<DailyHeatmap items={items} period="YTD" hidden />)
    expect(html).not.toContain('€300.00')
    expect(html).toContain('+2.00%')
    expect(html).toContain('hide=1')
  })
  it('shows missing data and an empty state honestly', () => {
    const html = renderToStaticMarkup(<DailyHeatmap items={[{ ...items[0], value: null, changePercent: null, observedOn: null, previousOn: null }]} period="MAX" />)
    expect(html).toContain('Unavailable')
    expect(html).not.toContain('+0.00%')
    expect(renderToStaticMarkup(<DailyHeatmap items={[]} period="MAX" />)).toContain('No open positions')
  })
})

describe('cash position', () => {
  const cash = { accountId: 'cash', accountName: 'Cash', symbol: 'CASH', name: 'Cash', kind: 'cash' as const, value: '0', changePercent: '0', observedOn: null, previousOn: null }

  it('is listed like any position with its EUR value but has no detail link', () => {
    const html = renderToStaticMarkup(<DailyHeatmap items={[items[0], cash]} period="MAX" />)
    expect(html).toContain('<strong>Cash</strong>')
    expect(html).toContain('€0.00')
    expect(html).not.toContain('symbol=CASH')
    expect(html).not.toContain('CASH · Cash')
    expect(html).not.toContain('No price date')
  })

  it('hides the cash amount in hide mode', () => {
    const html = renderToStaticMarkup(<DailyHeatmap items={[items[0], cash]} period="MAX" hidden />)
    expect(html).toContain('<strong>Cash</strong>')
    expect(html).not.toContain('€0.00')
  })
})

 describe('readable position labels', () => {
  it('shows investment names with codes as a secondary identifier', () => {
    const named = [{ ...items[0], name: 'Synthetic Global Equity Fund' }]
    const html = renderToStaticMarkup(<DailyHeatmap items={named} period="MAX" />)
    expect(html).toContain('<strong>Synthetic Global Equity Fund</strong>')
    expect(html).toContain('GAIN')
  })

  it('gives tiny holdings a visible key and keeps their names and returns outside collapsed controls', () => {
    const tiny = { ...items[1], symbol: 'TINY', name: 'Synthetic Small Holding', value: '0.01' }
    const html = renderToStaticMarkup(<DailyHeatmap items={[items[0], tiny]} period="MAX" />)
    const tile = html.match(/<a[^>]*class="heatmap-tile negative"[^>]*>(.*?)<\/a>/)?.[1]
    expect(tile).toContain('tile-key')
    expect(html).not.toContain('<details')
    expect(html).toContain('<strong>Synthetic Small Holding</strong>')
    expect(html).toContain('-1.00%')
  })
})

describe('text fitting the tiles', () => {
  const tileOf = (html: string, tone: string) => html.match(new RegExp(`<a[^>]*class="heatmap-tile ${tone}"[^>]*>(.*?)</a>`))?.[1] ?? ''

  it('renders every tile with its name, code and return so the box size decides what fits', () => {
    const tiny = { ...items[1], symbol: 'TINY', name: 'Synthetic Small Holding', value: '0.01' }
    const tile = tileOf(renderToStaticMarkup(<DailyHeatmap items={[items[0], tiny]} period="MAX" />), 'negative')
    expect(tile).toContain('<strong>Synthetic Small Holding</strong>')
    expect(tile).toContain('<span class="tile-short">TINY</span>')
    expect(tile).toContain('-1.00%')
    expect(tile).toContain('€0.01')
  })

  it('keeps hidden values out of every tile', () => {
    const tile = tileOf(renderToStaticMarkup(<DailyHeatmap items={items} period="MAX" hidden />), 'positive')
    expect(tile).not.toContain('€')
  })

  it('sizes tile text from the tile itself with container queries', () => {
    const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.heatmap-tile \{[^}]*container-type: size/)
    expect(css).toContain('@container (min-width: 44px) and (min-height: 12px)')
    expect(css).toContain('@container (min-width: 70px) and (min-height: 48px)')
    expect(css).toContain('@container (max-width: 10px)')
    expect(css).toContain('@container (min-width: 150px) and (min-height: 120px)')
  })

  it('never sets readable tile or list text below 12px, and keeps summary and cash rows usable', () => {
    const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')
    const tileRules = css.split('\n').filter((line) => /heatmap-tile|\.tile-/.test(line) && !line.includes('.tile-key'))
    expect(tileRules.join('\n')).not.toMatch(/font-size: 1[01]px/)
    expect(css).toMatch(/summary \{[^}]*min-height: 44px/)
    expect(css).toMatch(/\.movement-details li > div \{[^}]*justify-content: space-between/)
  })
})
