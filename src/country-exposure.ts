import { add, decimalToFraction, divide, formatFraction, multiply, subtract } from './fraction'
import type { Fraction } from './fraction'

export type CountryComposition = { weights: Record<string, string>; source: string; asOf: string | null; fetchedAt?: string | null }

const zero = decimalToFraction('0')
const hundred = decimalToFraction('100')
// Provider spellings mapped to the world-map shape names
const COUNTRY_ALIASES: Record<string, string> = { 'United States of America': 'United States', 'Czech Republic': 'Czechia', Korea: 'South Korea' }

export const COMPLETE_COVERAGE_PERCENT = '95'

export function weightCoverage(weights: Record<string, string>) {
  return formatFraction(Object.values(weights).reduce((sum, percent) => add(sum, decimalToFraction(percent)), zero))
}

export function countryExposure(positions: { symbol: string; value: string | null }[], compositions: Record<string, CountryComposition>) {
  let total = zero
  let unknown = zero
  const countries = new Map<string, Fraction>()
  for (const position of positions) {
    if (position.value === null) continue
    const value = decimalToFraction(position.value)
    if (value.numerator === 0n) continue
    total = add(total, value)
    const entries = Object.entries(compositions[position.symbol]?.weights ?? {}).map(([label, percent]) => [COUNTRY_ALIASES[label] ?? label, decimalToFraction(percent)] as const).filter(([, weight]) => weight.numerator !== 0n)
    const covered = entries.reduce((sum, [, weight]) => add(sum, weight), zero)
    if (subtract(hundred, covered).numerator < 0n) throw new Error(`Country weights exceed 100%: ${position.symbol}`)
    // Compositions covering at least the threshold are treated as complete; the small remainder is spread proportionally
    const complete = covered.numerator !== 0n && subtract(covered, decimalToFraction(COMPLETE_COVERAGE_PERCENT)).numerator >= 0n
    for (const [country, weight] of entries) {
      const scaled = complete ? divide(multiply(weight, hundred), covered) : weight
      countries.set(country, add(countries.get(country) ?? zero, divide(multiply(value, scaled), hundred)))
    }
    if (!complete) unknown = add(unknown, divide(multiply(value, subtract(hundred, covered)), hundred))
  }
  const share = (value: Fraction) => ({ value: formatFraction(value), percent: total.numerator === 0n ? '0' : formatFraction(divide(multiply(value, hundred), total)) })
  return {
    total: formatFraction(total),
    countries: [...countries].map(([country, value]) => ({ country, ...share(value) })).sort((a, b) => Number(b.value) - Number(a.value) || a.country.localeCompare(b.country)),
    unknown: share(unknown),
  }
}
