import type { PerformancePeriod } from './performance-period'

export const PERIODS: { value: PerformancePeriod; label: string }[] = [
  { value: 'MAX', label: 'Max' },
  { value: '1Y', label: '1 year' },
  { value: 'YTD', label: 'Year to date' },
  { value: 'MTD', label: 'Month to date' },
  { value: 'WTD', label: 'Week to date' },
]

export function parsePeriod(value: string | undefined): PerformancePeriod {
  return PERIODS.find((period) => period.value === value)?.value ?? 'MAX'
}

const hundredths = (value: string) => Math.round(Number(value) * 100)
const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export function formatEur(value: string): string {
  return euro.format(Number(value))
}

const dollar = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatUsd(value: string): string {
  return dollar.format(Number(value))
}

export function formatPercent(value: string | null): string {
  if (value === null) return '–'
  const rounded = hundredths(value)
  return `${rounded > 0 ? '+' : ''}${(rounded / 100).toFixed(2)}%`
}

export function tone(value: string | null): 'positive' | 'negative' | 'neutral' {
  const rounded = value === null ? 0 : hundredths(value)
  return rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'neutral'
}

export function chartGeometry(series: { changePercent: string | null }[], width: number, height: number) {
  const points = series.flatMap((day, index) =>
    day.changePercent === null ? [] : [{ index, percent: Number(day.changePercent) }])
  if (points.length === 0) return { path: '', zeroY: null }
  const low = Math.min(0, ...points.map((point) => point.percent))
  const high = Math.max(0, ...points.map((point) => point.percent))
  const x = (index: number) => (series.length === 1 ? 0 : (index / (series.length - 1)) * width)
  const y = (percent: number) => (high === low ? height / 2 : ((high - percent) / (high - low)) * height)
  const round = (value: number) => Math.round(value * 100) / 100
  const path = points
    .map((point, order) => `${order === 0 ? 'M' : 'L'}${round(x(point.index))} ${round(y(point.percent))}`)
    .join('')
  return { path, zeroY: round(y(0)) }
}

// Round percentages to label the scale, on the same vertical scale as chartGeometry; zero is left to the baseline.
export function chartTicks(series: { changePercent: string | null }[], height: number) {
  const percents = series.flatMap((day) => (day.changePercent === null ? [] : [Number(day.changePercent)]))
  const low = Math.min(0, ...percents)
  const high = Math.max(0, ...percents)
  if (percents.length === 0 || high === low) return []
  const raw = (high - low) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = (raw / magnitude <= 1 ? 1 : raw / magnitude <= 2 ? 2 : raw / magnitude <= 5 ? 5 : 10) * magnitude
  const ticks = []
  for (let k = Math.ceil(low / step); k <= Math.floor(high / step); k++) {
    if (k !== 0) ticks.push({ percent: Number((k * step).toFixed(6)), y: Math.round(((high - k * step) / (high - low)) * height * 100) / 100 })
  }
  return ticks
}

// Pairs each plotted observation with its coordinates; observations without a return are not plotted.
export function chartPoints<T extends { changePercent: string | null }>(series: T[], { path }: { path: string }) {
  const coordinates = [...path.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)]
  return series.filter((day) => day.changePercent !== null)
    .map((day, order) => ({ ...day, x: Number(coordinates[order][1]), y: Number(coordinates[order][2]) }))
}

// Index of the point horizontally closest to x (the earlier one on a tie), or -1 without points.
export function nearestPoint(points: { x: number }[], x: number): number {
  let best = -1
  points.forEach((point, index) => {
    if (best === -1 || Math.abs(point.x - x) < Math.abs(points[best].x - x)) best = index
  })
  return best
}

// The filled area closes the line down to the zero baseline; the marker sits on the latest point.
export function chartAccent({ path, zeroY }: { path: string; zeroY: number | null }) {
  const points = [...path.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || zeroY === null) return { area: '', end: null }
  return { area: `${path}L${last.x} ${zeroY}L${first.x} ${zeroY}Z`, end: last }
}
