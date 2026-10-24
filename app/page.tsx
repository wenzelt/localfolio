import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { readPositionReport } from '../src/positions'
import { readRateHistory } from '../src/fx-cache'
import { withCash } from '../src/cash'
import { readDailyMovement } from '../src/daily-movement'
import { readSecurityNames } from '../src/security-names'
import { readCountryCompositions } from '../src/country-cache'
import { Dashboard } from '../src/dashboard'
import { readPerformanceReport } from '../src/performance-report'
import { openReadOnly } from '../src/valuation-cli'
import { PreferenceSync } from '../src/preference-sync'
import { parseTheme } from '../src/theme-choice'
import { resolveViewPreferences } from '../src/view-preferences'
import { authenticated } from '../src/web-auth'

export const dynamic = 'force-dynamic'
const sql = openReadOnly(process.env.DATABASE_URL ?? '')

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string; hide?: string; account?: string; symbol?: string }> }) {
  const jar = await cookies()
  if (!authenticated(jar.toString(), process.env.SESSION_SECRET ?? '', Date.now())) redirect('/login')
  const { period, hide, account, symbol } = await searchParams
  const view = resolveViewPreferences({ period, hide }, jar.toString())
  const asOf = new Date().toISOString().slice(0, 10)
  const names = await readSecurityNames(sql)
  const rates = await readRateHistory(sql, asOf)
  const positions = (await readPositionReport(sql, Object.fromEntries(rates.map((rate) => [rate.date, rate.eurPerUsd])))).filter((position) => !position.isExcluded).map((position) => ({ ...position, name: names[position.symbol] ?? null }))
  const scoped = account !== undefined || symbol !== undefined
  const position = scoped ? positions.find((holding) => holding.accountId === account && holding.symbol === symbol) : undefined
  if (scoped && !position) notFound()
  const report = await readPerformanceReport(sql, asOf, view.period, position ? { accountId: position.accountId, symbol: position.symbol } : undefined)
  const daily = scoped ? [] : withCash((await readDailyMovement(sql, asOf)).map((item) => ({ ...item, name: names[item.symbol] ?? null })))
  return <>
    <PreferenceSync period={view.period} hidden={view.hidden} />
    <Dashboard report={report} hidden={view.hidden} theme={parseTheme(jar.toString())} position={position} daily={daily} countries={scoped ? {} : await readCountryCompositions(sql)} />
  </>
}
