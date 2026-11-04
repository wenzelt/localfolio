// Every period the report accepts. The dashboard no longer offers 1D, but the report still does.
const SUPPORTED = ['MAX', '5Y', '1Y', '6M', '3M', '1M', 'YTD', 'MTD', 'WTD', '1D'] as const
export type PerformancePeriod = (typeof SUPPORTED)[number]

const TRAILING_MONTHS: Partial<Record<PerformancePeriod, number>> = { '5Y': 60, '1Y': 12, '6M': 6, '3M': 3, '1M': 1 }

export function performanceStart(period: PerformancePeriod, asOf: string, firstActivity: string | null): string | null {
  const date = new Date(`${asOf}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) {
    throw new Error('Invalid performance date')
  }
  if (!SUPPORTED.includes(period)) throw new Error('Unsupported period')
  if (firstActivity === null || firstActivity > asOf) return null
  if (period === 'MAX') return firstActivity
  const months = TRAILING_MONTHS[period]
  if (months !== undefined) {
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() - months)
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
