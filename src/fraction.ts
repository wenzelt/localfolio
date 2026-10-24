export type Fraction = {
  numerator: bigint
  denominator: bigint
}

export function decimalToFraction(value: string): Fraction {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`)
  }

  const [whole, fractional = ''] = value.split('.')
  return reduce({
    numerator: BigInt(`${whole}${fractional}`),
    denominator: 10n ** BigInt(fractional.length),
  })
}

export function add(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  })
}

export function subtract(left: Fraction, right: Fraction): Fraction {
  return add(left, { numerator: -right.numerator, denominator: right.denominator })
}

export function multiply(left: Fraction, right: Fraction): Fraction {
  return reduce({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  })
}

export function divide(left: Fraction, right: Fraction): Fraction {
  if (right.numerator === 0n) {
    throw new Error('Cannot divide by zero')
  }

  return reduce({
    numerator: left.numerator * right.denominator,
    denominator: left.denominator * right.numerator,
  })
}

export function formatFraction(value: Fraction, precision = 26): string {
  if (value.numerator < 0n) {
    return `-${formatFraction({ numerator: -value.numerator, denominator: value.denominator }, precision)}`
  }
  const whole = value.numerator / value.denominator
  let remainder = value.numerator % value.denominator

  if (remainder === 0n) {
    return whole.toString()
  }

  let decimals = ''
  for (let index = 0; index < precision && remainder !== 0n; index += 1) {
    remainder *= 10n
    decimals += (remainder / value.denominator).toString()
    remainder %= value.denominator
  }

  return `${whole}.${decimals.replace(/0+$/, '')}`
}

function reduce(value: Fraction): Fraction {
  const divisor = greatestCommonDivisor(value.numerator, value.denominator)
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right

  while (b !== 0n) {
    ;[a, b] = [b, a % b]
  }

  return a
}
