import type { readPerformanceReport } from './performance-report'
import { InteractiveChart } from './chart'
import { formatEur, formatPercent, formatUsd, tone } from './dashboard-view'
import { decimalToFraction, formatFraction, multiply } from './fraction'
import { dailySummary } from './daily-summary'
import { DailyHeatmap } from './heatmap'
import { CountryMap } from './country-map'
import type { CountryComposition } from './country-exposure'
import { LiveRefresh } from './live-refresh'
import { RemovePositionControl } from './remove-position-control'
import { PeriodControl } from './period-control'
import { ThemePicker } from './theme-picker'
import { StarBanner, StarMark, StarPattern, StarSticker } from './stars'
import type { Theme } from './theme-choice'

import type { positionReport } from './positions'

type Report = Awaited<ReturnType<typeof readPerformanceReport>>
type Position = ReturnType<typeof positionReport>[number] & { name?: string | null }

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

// A privacy switch kept as a plain link: the URL carries the state, so it works without script and survives a reload.
function PrivacyToggle({ href, hidden }: { href: string; hidden: boolean }) {
  return <a className="privacy-toggle" href={href} data-hidden={hidden}>
    <svg {...icon} aria-hidden="true" focusable="false">{hidden
      ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7a11.6 11.6 0 0 1-2.6 3.9M6.6 6.7A11.7 11.7 0 0 0 2.5 12c1 2.8 4.5 7 9.5 7a9.6 9.6 0 0 0 4.2-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>
      : <><path d="M2.5 12C3.5 9.2 7 5 12 5s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7s-8.5-4.2-9.5-7z" /><circle cx="12" cy="12" r="3" /></>}</svg>
    <span>{hidden ? 'Show values' : 'Hide values'}</span>
  </a>
}

const Mark = () => <svg className="mark" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
  <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="currentColor" strokeWidth="1.5" />
  <path d="M6 16l4-4.5 3 2.5 5-6" stroke="var(--chart)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
</svg>

export function Dashboard({ report, hidden = false, theme = 'ledger', position, daily = [], countries = {} }: { report: Report; hidden?: boolean; theme?: Theme; position?: Position; daily?: Parameters<typeof DailyHeatmap>[0]['items']; countries?: Record<string, CountryComposition> }) {
  const period = report?.period ?? 'MAX'
  const scope = position ? `account=${encodeURIComponent(position.accountId)}&symbol=${encodeURIComponent(position.symbol)}&` : ''
  const mask = <span className="mask" role="img" aria-label="Value hidden">••••</span>
  const summary = position ? null : dailySummary(daily)
  const today = summary?.date ? summary : null
  // A USD holding also shows its USD market value, from the latest USD close on the position's series.
  // Only a position-scoped report carries a close on each point.
  const lastPrice = (report?.series.at(-1) as { price?: { close: string; currency: string } | null } | undefined)?.price
  const nativeValue = position?.status === 'calculated' && position.nativeInvested !== undefined && lastPrice?.currency === 'USD'
    ? formatFraction(multiply(decimalToFraction(position.quantity), decimalToFraction(lastPrice.close))) : null
  // The pop art theme's artwork is rendered only in that theme, so the others carry none of it.
  const pop = theme === 'popart'
  return <main>
    <header><a href={hidden ? '/?hide=1' : '/'} className="brand">{pop ? <StarMark className="mark star-mark" /> : <Mark />}<span>Localfolio</span></a><div className="actions"><a className="quiet add-buy" href="/buy">Add buy</a><PrivacyToggle href={`/?${scope}period=${period}${hidden ? '&hide=0' : '&hide=1'}`} hidden={hidden} /><ThemePicker theme={theme} /><form action="/logout" method="post"><button type="submit" className="quiet">Log out</button></form></div></header>
    <p><a className="quiet" href="/import">Import positions</a> · <a className="quiet" href="/accounts">Manage accounts</a></p>
    {!report ? <section className="card">{pop && <StarMark className="star-empty" />}<h1>No portfolio imported</h1><p>Import your Ghostfolio export, or record transactions by hand, then refresh market data.</p>
      <p><a className="quiet" href="/import/ghostfolio">Upload your Ghostfolio export</a></p><p><code>npm run import:ghostfolio -- &lt;file&gt;</code></p><p><code>npm run ledger:add -- account --name &lt;name&gt; --currency EUR</code></p></section> : <>
      {pop && <StarBanner />}
      <section className="heading"><div>{position && <a className="back" href={`/?period=${period}${hidden ? '&hide=1' : ''}`}>Back to portfolio</a>}<h1>{position?.name || position?.symbol || 'Your portfolio'}</h1>{position?.name && <p className="muted">{position.symbol}</p>}<p className="meta">{position ? `${position.accountName} · EUR` : 'Overview · EUR'}<LiveRefresh fetchedAt={report.freshness.fetchedAt} /></p>{!position && <a className="quiet buy-more overview-buy" href="/buy">Add buy</a>}{position && <a className="quiet buy-more" href={`/buy?account=${encodeURIComponent(position.accountId)}&symbol=${encodeURIComponent(position.symbol)}`}>Buy more</a>}</div>
        <PeriodControl period={report.period} />
      </section>
      {position && <section className="card"><h2>Position</h2>{position.status === 'calculated' ? <dl className="stats"><div><dt>Quantity</dt><dd>{hidden ? mask : position.quantity}</dd></div><div><dt>Cost basis · {position.currency}</dt><dd>{hidden ? mask : position.currency === 'EUR' ? formatEur(position.invested) : position.invested}</dd></div>{position.nativeInvested !== undefined && <div><dt>Cost basis · USD</dt><dd>{hidden ? mask : formatUsd(position.nativeInvested)}</dd></div>}{nativeValue !== null && <div><dt>Value · USD</dt><dd>{hidden ? mask : formatUsd(nativeValue)}</dd></div>}</dl> : <p role="status">Historical FX required to calculate this position.</p>}</section>}
      {position && <RemovePositionControl accountId={position.accountId} accountName={position.accountName} symbol={position.symbol} />}
      <section className="card">
        {pop && <StarSticker label="Stars & stripes" />}
        <div className="summary"><div><p className="label">Net invested value</p><div className="value">{hidden ? mask : formatEur(report.value)}</div></div>
        <dl className="stats"><div><dt>Change</dt><dd className={tone(report.change)}>{hidden ? mask : formatEur(report.change)}</dd></div><div><dt>Return</dt><dd className={tone(report.changePercent)}>{formatPercent(report.changePercent)}</dd></div>{today && <div><dt title={`Latest available session per holding; excludes FX-only movements. ${today.excluded} holding(s) without a comparable move excluded.`}>{`Today · ${today.date}`}</dt><dd className={tone(today.changePercent)}>{hidden ? mask : formatEur(today.change)} · {formatPercent(today.changePercent)}{today.staleCount > 0 && <small className="muted"> {today.staleCount} {today.staleCount === 1 ? 'holding' : 'holdings'} still on {today.oldestDate} or earlier</small>}</dd></div>}</dl></div>
        <InteractiveChart key={report.period} series={report.series} tone={tone(report.changePercent)} hidden={hidden} />
        <div className="dates"><time>{report.from}</time><time>{report.to}</time></div>
      </section>
      {!position && <div className="panels"><DailyHeatmap items={daily} period={report.period} hidden={hidden} /><CountryMap positions={daily} compositions={countries} hidden={hidden} /></div>}
      {report.freshness.stale.includes('prices') && <aside className="warning" role="status">{report.freshness.pricesThrough ? `Prices are out of date (latest close ${report.freshness.pricesThrough})` : 'Prices are unavailable'}</aside>}
      {report.freshness.stale.includes('fx') && <aside className="warning" role="status">{report.freshness.ratesThrough ? `Exchange rates are out of date (latest rate ${report.freshness.ratesThrough})` : 'Exchange rates are unavailable'}</aside>}
      {report.unpriced.length > 0 && <aside className="warning" role="status">{report.unpriced.length} positions unpriced and excluded: {report.unpriced.join(', ')}</aside>}
      <p className="footnote">Modified Dietz return · Daily closing prices · Excluded accounts omitted · Cash and dividends not included</p>
    </>}
    {pop && <div className="star-footer"><StarPattern /></div>}
  </main>
}

export function LoginForm({ error }: { error: boolean }) {
  return <main className="login"><section className="card"><p className="brand"><Mark />Localfolio</p><h1>Welcome back</h1><p className="muted">Sign in to your personal portfolio.</p>
    <form action="/login/submit" method="post"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
      {error && <p role="alert" className="negative">Incorrect password</p>}<button type="submit">Sign in</button>
    </form></section></main>
}
