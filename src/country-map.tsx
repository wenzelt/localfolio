import type { CSSProperties } from 'react'
import { COMPLETE_COVERAGE_PERCENT, countryExposure, weightCoverage } from './country-exposure'
import type { CountryComposition } from './country-exposure'
import { formatEur } from './dashboard-view'
import { compositionFreshness } from './country-freshness'
import world from './world-paths.json'

export function CountryMap({ positions, compositions, hidden = false }: {
  positions: { symbol: string; value: string | null }[]; compositions: Record<string, CountryComposition>; hidden?: boolean
}) {
  const exposure = countryExposure(positions, compositions)
  const percent = (value: string) => `${Number(value).toFixed(2)}%`
  const byCountry = new Map(exposure.countries.map((country) => [country.country, country]))
  const sources = [...new Set(positions.filter((position) => position.value !== null && Number(position.value) > 0).map((position) => position.symbol))]
  return <section className="card country-exposure" aria-labelledby="country-exposure-title">
    <h2 id="country-exposure-title">Country exposure</h2>
    <p className="muted">Share of priced positions in EUR · Stocks: headquarters country · Funds: reported country weights, not revenue exposure. Unpriced positions excluded.</p>
    {exposure.total === '0' ? <p className="empty">No priced open positions</p> : <>
      <svg className="country-world" viewBox="0 0 720 310" role="img" aria-labelledby="country-map-title">
        <title id="country-map-title">World map of portfolio country exposure. Country percentages are listed below.</title>
        {world.map(({ name, path }) => {
          const weight = byCountry.get(name)?.percent
          return <path key={name} d={path} className={weight ? 'country-known' : 'country-unweighted'} style={{ '--country-intensity': Math.min(Number(weight ?? '0') / 50, 1) } as CSSProperties}>
            <title>{`${name}: ${weight ? percent(weight) : 'No allocated exposure'}`}</title>
          </path>
        })}
      </svg>
      <p className="muted">Colour scale: 0–50% or more of the portfolio. Grey: no allocated country exposure.</p>
      <div className="country-allocation" aria-hidden="true">
        {exposure.countries.map((country) => <span key={country.country} className="country-known" style={{ width: `${country.percent}%`, '--country-intensity': Math.min(Number(country.percent) / 50, 1) } as CSSProperties} title={`${country.country}: ${percent(country.percent)}`} />)}
        <span className="country-unknown" style={{ width: `${exposure.unknown.percent}%` }} title={`Other / not broken down: ${percent(exposure.unknown.percent)}`} />
      </div>
      <ul>{[...exposure.countries, { country: 'Other / not broken down', ...exposure.unknown }].map((country) => <li key={country.country}>
        <span>{country.country}{country.country !== 'Other / not broken down' && !world.some((shape) => shape.name === country.country) && ' (not shown on map)'}</span><span>{percent(country.percent)}{!hidden && <> · {formatEur(country.value)}</>}</span>
      </li>)}</ul>
      <details><summary>Sources and dates</summary><p className="muted">Missing weights remain in the grey category, except for holdings whose published weights cover at least 95%, which are treated as complete. Source dates are not live. Country weights older than 90 days are marked stale; a recent fetch does not make old holdings current.</p><ul>{sources.map((symbol) => <li key={symbol}>
        {!compositions[symbol] || Object.keys(compositions[symbol].weights).length === 0
          ? <span>{symbol} · Country weights unavailable</span>
          : <span>{symbol} · {compositions[symbol].asOf ?? 'Source date unavailable'} · {compositionFreshness(compositions[symbol].asOf, new Date()) === 'stale' ? 'Stale country weights' : compositionFreshness(compositions[symbol].asOf, new Date()) === 'unknown' ? 'Freshness unknown' : 'Current country weights'} · Coverage: {Number(weightCoverage(compositions[symbol].weights)).toFixed(2)}%{Number(weightCoverage(compositions[symbol].weights)) >= Number(COMPLETE_COVERAGE_PERCENT) && ' · scaled to 100%'} · Last fetched: {compositions[symbol].fetchedAt?.slice(0, 10) ?? 'unavailable'} · <a href={compositions[symbol].source} target="_blank" rel="noreferrer">Source</a></span>}
      </li>)}</ul></details>
      <small className="muted">Map: Natural Earth, public domain. Small countries may only appear in the list.</small>
    </>}
  </section>
}
