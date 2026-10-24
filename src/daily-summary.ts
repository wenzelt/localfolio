import { add, decimalToFraction, divide, formatFraction, multiply, subtract } from './fraction'
import type { Fraction } from './fraction'

const zero = decimalToFraction('0')
const one = decimalToFraction('1')
const hundred = decimalToFraction('100')

const signed = (value: string): Fraction => value.startsWith('-') ? subtract(zero, decimalToFraction(value.slice(1))) : decimalToFraction(value)

// Today's move across positions, summed from each one's latest session so it agrees with the movement tiles.
// The percentage is relative to what the counted positions were worth the session before.
export function dailySummary(items: { value: string | null; changePercent: string | null; observedOn: string | null }[]) {
  let change = zero
  let previousTotal = zero
  let date: string | null = null
  let excluded = 0

  for (const item of items) {
    if (item.value === null || item.changePercent === null) {
      excluded++
      continue
    }
    const factor = add(one, divide(signed(item.changePercent), hundred))
    if (factor.numerator <= 0n) {
      excluded++
      continue
    }
    const value = signed(item.value)
    const previous = divide(value, factor)
    change = add(change, subtract(value, previous))
    previousTotal = add(previousTotal, previous)
    if (item.observedOn !== null && (date === null || item.observedOn > date)) date = item.observedOn
  }

  return {
    change: formatFraction(change),
    changePercent: previousTotal.numerator <= 0n ? null : formatFraction(multiply(divide(change, previousTotal), hundred)),
    date,
    excluded,
  }
}
