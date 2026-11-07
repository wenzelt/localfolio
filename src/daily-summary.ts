import { add, decimalToFraction, divide, formatFraction, multiply, subtract, signedDecimalToFraction } from './fraction'

const zero = decimalToFraction('0')
const one = decimalToFraction('1')
const hundred = decimalToFraction('100')

// Today's move across positions, summed from each one's latest session. A position's EUR change, when given,
// includes the exchange-rate move, so the total agrees with the chart; without one the quoted-currency percentage is used.
// The percentage is relative to what the counted positions were worth in EUR the session before.
export function dailySummary(items: { value: string | null; change?: string | null; changePercent: string | null; observedOn: string | null }[]) {
  let change = zero
  let previousTotal = zero
  let date: string | null = null
  let oldestDate: string | null = null
  const counted: string[] = []
  let excluded = 0

  for (const item of items) {
    if (item.value === null || item.changePercent === null || item.change === null) {
      excluded++
      continue
    }
    const value = signedDecimalToFraction(item.value)
    const factor = add(one, divide(signedDecimalToFraction(item.changePercent), hundred))
    if (factor.numerator <= 0n) {
      excluded++
      continue
    }
    const previous = item.change === undefined ? divide(value, factor) : subtract(value, signedDecimalToFraction(item.change))
    if (item.change !== undefined && previous.numerator <= 0n) {
      excluded++
      continue
    }
    change = add(change, subtract(value, previous))
    previousTotal = add(previousTotal, previous)
    if (item.observedOn !== null) {
      counted.push(item.observedOn)
      if (date === null || item.observedOn > date) date = item.observedOn
      if (oldestDate === null || item.observedOn < oldestDate) oldestDate = item.observedOn
    }
  }

  return {
    change: formatFraction(change),
    changePercent: previousTotal.numerator <= 0n ? null : formatFraction(multiply(divide(change, previousTotal), hundred)),
    date,
    excluded,
    // Counted positions whose latest session is older than the dated one, e.g. US holdings before the Monday open.
    staleCount: counted.filter((observedOn) => observedOn !== date).length,
    oldestDate,
  }
}
