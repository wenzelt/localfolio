'use client'

import { useState } from 'react'
import type { PointerEvent } from 'react'
import { chartAccent, chartGeometry, chartPoints, chartTicks, formatEur, formatPercent, nearestPoint, tone } from './dashboard-view'

type Price = { close: string; currency: 'EUR' | 'USD'; date: string }
type Observation = { date: string; value: string; changePercent: string | null; price?: Price | null }

const quote = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
// A carried-forward close names the day it was actually observed.
const priceText = (price: Price, day: string) =>
  `${quote.format(Number(price.close))} ${price.currency}${price.date === day ? '' : ` (close ${price.date})`}`

// A touch or a click pins a date until it is cleared; a mouse hover only previews one and falls back on leaving.
type Selection = { hover: number | null; pinned: number | null }
const pinnedAt = (pinned: number | null) => (state: Selection) =>
  state.pinned === pinned && state.hover === null ? state : { hover: null, pinned }
const hoverAt = (hover: number | null) => (state: Selection) => (state.hover === hover ? state : { ...state, hover })

export function InteractiveChart({ series, tone: trend, hidden = false }: { series: Observation[]; tone: string; hidden?: boolean }) {
  const [selection, select] = useState<Selection>({ hover: null, pinned: null })
  const geometry = chartGeometry(series, 1000, 280)
  const points = chartPoints(series, geometry)
  if (points.length === 0) return <p className="empty">Not enough price history</p>
  const accent = chartAccent(geometry)
  const ticks = chartTicks(series, 280)
  const index = selection.hover ?? selection.pinned ?? points.length - 1
  const current = points[index]
  const at = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return box.width > 0 ? nearestPoint(points, ((event.clientX - box.left) / box.width) * 1000) : null
  }
  const press = (event: PointerEvent<SVGSVGElement>) => {
    // Capture keeps the drag on the chart when the finger or cursor strays past its edge.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const point = at(event)
    if (point !== null) select(pinnedAt(point))
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const point = at(event)
    if (point === null) return
    select(event.pointerType === 'mouse' && event.buttons === 0 ? hoverAt(point) : pinnedAt(point))
  }
  return <>
    <svg viewBox="0 -12 1000 304" role="img" aria-label="Portfolio performance" className={`chart ${trend}`}
      onPointerDown={press} onPointerMove={move} onPointerLeave={() => select(hoverAt(null))}>
      <title>Portfolio performance</title>
      {ticks.map(({ percent, y }) => <g key={percent}><line x1="0" x2="1000" y1={y} y2={y} className="grid" />
        <text x="0" y={y - 8} className="axis">{`${percent > 0 ? '+' : ''}${percent}%`}</text></g>)}
      <line x1="0" x2="1000" y1={geometry.zeroY ?? 0} y2={geometry.zeroY ?? 0} className="baseline" />
      <text x="0" y={Number(geometry.zeroY) - 8} className="axis">0%</text>
      <g className="chart-reveal"><path d={accent.area} className="area" />
      <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </g>{index !== points.length - 1 && <line x1={current.x} x2={current.x} y1="-12" y2="292" className="guide" />}
      <g className="chart-endpoint"><circle cx={current.x} cy={current.y} r="6" className="marker" /></g>
    </svg>
    <div className="readout-bar"><p className="readout" aria-live="polite">
      <time>{current.date}</time>
      <span>{hidden ? <span className="mask" role="img" aria-label="Value hidden">••••</span> : formatEur(current.value)}</span>
      {current.price && <span>{hidden ? <>Price <span className="mask" role="img" aria-label="Value hidden">••••</span></> : `Price ${priceText(current.price, current.date)}`}</span>}
      <span className={tone(current.changePercent)}>{formatPercent(current.changePercent)}</span>
    </p>
    <button type="button" className="quiet latest" disabled={selection.pinned === null} onClick={() => select(pinnedAt(null))}>Latest</button></div>
    <input type="range" aria-label="Select date" aria-valuetext={`${current.date}, ${formatPercent(current.changePercent)}`}
      min={0} max={points.length - 1} value={index}
      onChange={(event) => select(pinnedAt(Number(event.target.value)))}
      onKeyDown={(event) => { if (event.key === 'Escape') select(pinnedAt(null)) }} />
  </>
}
