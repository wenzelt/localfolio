import type { HistoricalPrice } from './price-history'
import type { RateRow } from './performance'

const maxAgeDays = 7
const dayMilliseconds = 86_400_000

export type Freshness = { pricesThrough: string | null; ratesThrough: string | null; stale: ('prices' | 'fx')[] }

const newest = (dates: string[]) => dates.reduce<string | null>((latest, date) => (latest === null || date > latest ? date : latest), null)
const tooOld = (date: string | null, asOf: string) =>
  date === null || (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / dayMilliseconds > maxAgeDays

export function dataFreshness({ prices, rates, needsFx, asOf }: { prices: HistoricalPrice[]; rates: RateRow[]; needsFx: boolean; asOf: string }): Freshness {
  const pricesThrough = newest(prices.map((price) => price.observedOn))
  const ratesThrough = needsFx ? newest(rates.map((rate) => rate.date)) : null
  const stale: Freshness['stale'] = []
  if (tooOld(pricesThrough, asOf)) stale.push('prices')
  if (needsFx && tooOld(ratesThrough, asOf)) stale.push('fx')
  return { pricesThrough, ratesThrough, stale }
}
