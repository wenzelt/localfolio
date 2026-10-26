import type { CSSProperties, ReactNode } from 'react'
import type { PerformancePeriod } from './performance-period'
import { formatEur, formatPercent, tone } from './dashboard-view'

type Movement = {
  accountId: string; accountName: string; symbol: string; name?: string | null; kind?: 'cash'; value: string | null; change?: string | null
  changePercent: string | null; observedOn: string | null; previousOn: string | null
}
type Tile = { item: Movement; x: number; y: number; width: number; height: number }

// A row without a detail page (cash) is not a link.
const Row = ({ href, children }: { href?: string; children: ReactNode }) => href === undefined ? <div>{children}</div> : <a href={href}>{children}</a>

// An explicit plus sign on gains, so the amount reads as a movement rather than a balance.
const formatSigned = (change: string) => `${tone(change) === 'positive' ? '+' : ''}${formatEur(change)}`

export function movementIntensity(change: string | null) {
  return change === null ? 0 : Math.min(Math.abs(Number(change)) / 5, 1)
}

// Split the longest side around half the remaining value, preserving exact area weights.
export function tileLayout(items: Movement[]): Tile[] {
  const valued = items.filter((item) => Number(item.value) > 0).sort((a, b) => Number(b.value) - Number(a.value))
  function split(group: Movement[], x: number, y: number, width: number, height: number): Tile[] {
    if (group.length === 0) return []
    if (group.length === 1) return [{ item: group[0], x, y, width, height }]
    const total = group.reduce((sum, item) => sum + Number(item.value), 0)
    let cut = 1
    let first = Number(group[0].value)
    while (cut < group.length - 1 && first < total / 2) first += Number(group[cut++].value)
    const ratio = first / total
    return width >= height
      ? [...split(group.slice(0, cut), x, y, width * ratio, height), ...split(group.slice(cut), x + width * ratio, y, width * (1 - ratio), height)]
      : [...split(group.slice(0, cut), x, y, width, height * ratio), ...split(group.slice(cut), x, y + height * ratio, width, height * (1 - ratio))]
  }
  return split(valued, 0, 0, 1, 1)
}

export function DailyHeatmap({ items, period, hidden = false }: { items: Movement[]; period: PerformancePeriod; hidden?: boolean }) {
  const displayName = (item: Movement) => item.name || item.symbol
  const href = (item: Movement) => `/?account=${encodeURIComponent(item.accountId)}&symbol=${encodeURIComponent(item.symbol)}&period=${period}&hide=${hidden ? '1' : '0'}`
  const label = (item: Movement) => `${item.name || item.symbol} · ${item.symbol} · ${item.accountName} · ${item.changePercent === null ? 'Unavailable' : formatPercent(item.changePercent)} · ${item.observedOn ?? 'No price date'}${item.previousOn ? ` versus ${item.previousOn}` : ''}`
  return <section className="card daily-movement" aria-labelledby="daily-movement-title">
    <h2 id="daily-movement-title">Today’s movement</h2>
    <p className="muted">Latest trading session · Size: position value in EUR · Colour: price movement in quoted currency, not portfolio profit.</p>
    {items.length === 0 ? <p className="empty">No open positions</p> : <>
      <div className="heatmap">
        {tileLayout(items).map(({ item, x, y, width, height }, index) => <a key={`${item.accountId}-${item.symbol}`} href={href(item)}
          className={`heatmap-tile ${tone(item.changePercent)}`} aria-label={label(item)} title={label(item)}
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`, '--intensity': movementIntensity(item.changePercent) } as CSSProperties}>
          <span className="tile-key">{index + 1}</span>
          <strong>{displayName(item)}</strong><span className="tile-short">{item.symbol}</span>{item.name && <span className="tile-code">{item.symbol}</span>}<span className="tile-return">{item.changePercent === null ? 'Unavailable' : formatPercent(item.changePercent)}</span>{!hidden && <span className="tile-value">{formatEur(item.value ?? '0')}</span>}
        </a>)}
      </div>
      <p className="heatmap-legend"><span className="negative">−5% or lower</span><span>0% / unavailable: neutral</span><span className="positive">+5% or higher</span></p>
      <div className="movement-details"><h3>All positions and session dates</h3><ul>{[...tileLayout(items).map((tile) => tile.item), ...items.filter((item) => !(Number(item.value) > 0))].map((item, index) => <li key={`${item.accountId}-${item.symbol}`}><Row href={item.kind === 'cash' ? undefined : href(item)}>
        <span><span className="position-key">{index + 1}</span> <strong>{displayName(item)}</strong>{item.kind !== 'cash' && <><small>{item.name ? `${item.symbol} · ` : ''}{item.accountName}</small><small>{item.observedOn ?? 'No price date'}{item.previousOn && ` versus ${item.previousOn}`}</small></>}</span>
        <span className={tone(item.changePercent)}>{item.changePercent === null ? 'Unavailable' : formatPercent(item.changePercent)}{!hidden && <small>{item.value === null ? 'Value unavailable' : formatEur(item.value)}</small>}{!hidden && item.change != null && <small>{formatSigned(item.change)}</small>}</span>
      </Row></li>)}</ul></div>
    </>}
  </section>
}
