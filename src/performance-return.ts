import { add, decimalToFraction, divide, formatFraction, multiply, subtract } from './fraction'
import type { Fraction } from './fraction'

export type Flow = { date: string; amount: string }

const zero = decimalToFraction('0')
const dayMilliseconds = 86_400_000

function signed(value: string): Fraction {
  return value.startsWith('-') ? subtract(zero, decimalToFraction(value.slice(1))) : decimalToFraction(value)
}

function days(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMilliseconds
}

// Modified Dietz: a flow is weighted by the days it is held in the period, counting the day it arrives.
export function performanceReturn(opening: string, closing: string, from: string, to: string, flows: Flow[]) {
  const length = decimalToFraction(String(days(from, to) + 1))
  let netFlow = zero
  let capital = signed(opening)
  for (const flow of flows) {
    if (flow.date < from || flow.date > to) continue
    const amount = signed(flow.amount)
    netFlow = add(netFlow, amount)
    capital = add(capital, multiply(amount, divide(decimalToFraction(String(days(flow.date, to) + 1)), length)))
  }
  const change = subtract(subtract(signed(closing), signed(opening)), netFlow)
  return {
    change: formatFraction(change),
    changePercent: capital.numerator <= 0n ? null : formatFraction(multiply(divide(change, capital), decimalToFraction('100'))),
  }
}
