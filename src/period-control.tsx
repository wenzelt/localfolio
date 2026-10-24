'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { PERIODS } from './dashboard-view'
import type { PerformancePeriod } from './performance-period'

export function PeriodControl({ period }: { period: PerformancePeriod }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [shown, showOptimistically] = useOptimistic(period)
  return <form method="get" className="period" aria-busy={pending}>
    <label htmlFor="period">Timeframe</label>
    <select id="period" name="period" value={shown} onChange={(event) => {
      const next = new URLSearchParams(params.toString())
      next.set('period', event.target.value)
      startTransition(() => {
        showOptimistically(event.target.value as PerformancePeriod)
        router.push(`${pathname}?${next}`)
      })
    }}>{PERIODS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
    {[...params.entries()].filter(([key]) => key !== 'period').map(([key, value]) => <input key={`${key}-${value}`} type="hidden" name={key} value={value} />)}
    <noscript><button type="submit">Apply</button></noscript>
    <span role="status" className="period-status">{pending && <><span className="spinner" aria-hidden="true" /><span className="sr-only">Updating</span></>}</span>
  </form>
}
