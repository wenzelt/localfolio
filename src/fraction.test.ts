import { describe, expect, it } from 'vitest'
import { decimalToFraction, formatFraction, signedDecimalToFraction } from './fraction'

describe('signed decimals', () => {
  it('reads an optional leading minus and keeps the value exact', () => {
    expect(formatFraction(signedDecimalToFraction('-12.5'))).toBe('-12.5')
    expect(formatFraction(signedDecimalToFraction('0.1'))).toBe('0.1')
    expect(formatFraction(signedDecimalToFraction('-0.000000000000000000001'))).toBe('-0.000000000000000000001')
    expect(signedDecimalToFraction('-0')).toEqual(decimalToFraction('0'))
  })

  it('rejects anything but one optional minus before a plain decimal, naming the value', () => {
    for (const value of ['+1', '--1', '1-', '-', '', '1e3', ' 1', '-.5']) {
      expect(() => signedDecimalToFraction(value)).toThrow(`Invalid decimal value: ${value}`)
    }
  })
})
