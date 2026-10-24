export type PerformancePeriod = 'MAX' | '1Y' | 'YTD' | 'MTD' | 'WTD' | '1D'

export function performanceStart(period: PerformancePeriod, asOf: string, firstActivity: string | null): string | null {
  const date = new Date(`${asOf}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) {
    throw new Error('Invalid performance date')
  }
  if (!['MAX', '1Y', 'YTD', 'MTD', 'WTD', '1D'].includes(period)) throw new Error('Unsupported period')
  if (firstActivity === null || firstActivity > asOf) return null
  if (period === 'MAX') return firstActivity
  if (period === '1Y') {
    const month = date.getUTCMonth()
    date.setUTCFullYear(date.getUTCFullYear() - 1)
    if (date.getUTCMonth() !== month) date.setUTCDate(0)
  }
  if (period === 'YTD') date.setUTCMonth(0, 1)
  if (period === 'MTD') date.setUTCDate(1)
  if (period === 'WTD') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  const start = date.toISOString().slice(0, 10)
  return start < firstActivity ? firstActivity : start
}
