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

export function InteractiveChart({ series, tone: trend, hidden = false }: { series: Observation[]; tone: string; hidden?: boolean }) {
  const [selected, select] = useState<number | null>(null)
  const geometry = chartGeometry(series, 1000, 280)
  const points = chartPoints(series, geometry)
  if (points.length === 0) return <p className="empty">Not enough price history</p>
  const accent = chartAccent(geometry)
  const ticks = chartTicks(series, 280)
  const index = selected ?? points.length - 1
  const current = points[index]
  const choose = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) select(nearestPoint(points, ((event.clientX - box.left) / box.width) * 1000))
  }
  return <>
    <svg viewBox="0 -12 1000 304" role="img" aria-label="Portfolio performance" className={`chart ${trend}`}
      onPointerMove={choose} onPointerDown={choose} onPointerLeave={() => select(null)}>
      <title>Portfolio performance</title>
      {ticks.map(({ percent, y }) => <g key={percent}><line x1="0" x2="1000" y1={y} y2={y} className="grid" />
        <text x="0" y={y - 8} className="axis">{`${percent > 0 ? '+' : ''}${percent}%`}</text></g>)}
      <line x1="0" x2="1000" y1={geometry.zeroY ?? 0} y2={geometry.zeroY ?? 0} className="baseline" />
      <text x="0" y={Number(geometry.zeroY) - 8} className="axis">0%</text>
      <g className="chart-reveal"><path d={accent.area} className="area" />
      <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </g><g className="chart-endpoint"><circle cx={current.x} cy={current.y} r="6" className="marker" /></g>
    </svg>
    <p className="readout" aria-live="polite">
      <time>{current.date}</time>
      <span>{hidden ? <span className="mask" role="img" aria-label="Value hidden">••••</span> : formatEur(current.value)}</span>
      {current.price && <span>{hidden ? <>Price <span className="mask" role="img" aria-label="Value hidden">••••</span></> : `Price ${priceText(current.price, current.date)}`}</span>}
      <span className={tone(current.changePercent)}>{formatPercent(current.changePercent)}</span>
    </p>
    <input type="range" aria-label="Select date" aria-valuetext={`${current.date}, ${formatPercent(current.changePercent)}`}
      min={0} max={points.length - 1} value={index}
      onChange={(event) => select(Number(event.target.value))}
      onKeyDown={(event) => { if (event.key === 'Escape') select(null) }} />
  </>
}
