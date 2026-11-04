export type PerformancePeriod = 'MAX' | '5Y' | '1Y' | '6M' | '3M' | '1M' | 'YTD' | 'MTD' | 'WTD' | '1D'

export function performanceStart(period: PerformancePeriod, asOf: string, firstActivity: string | null): string | null {
  const date = new Date(`${asOf}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) {
    throw new Error('Invalid performance date')
  }
  if (!['MAX', '5Y', '1Y', '6M', '3M', '1M', 'YTD', 'MTD', 'WTD', '1D'].includes(period)) throw new Error('Unsupported period')
  if (firstActivity === null || firstActivity > asOf) return null
  if (period === 'MAX') return firstActivity
  const back = { '1M': [0, 1], '3M': [0, 3], '6M': [0, 6], '1Y': [1, 0], '5Y': [5, 0] }[period as string]
  if (back) {
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() - back[0] * 12 - back[1])
    // Clamp to the last day of the target month, e.g. 31 Mar minus one month is 28 Feb.
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, last))
  }
  if (period === 'YTD') date.setUTCMonth(0, 1)
  if (period === 'MTD') date.setUTCDate(1)
  if (period === 'WTD') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  const start = date.toISOString().slice(0, 10)
  return start < firstActivity ? firstActivity : start
}
