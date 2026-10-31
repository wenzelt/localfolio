import { describe, expect, it } from 'vitest'
import { compositionProblem, countryExposure, usableCompositions, weightCoverage } from './country-exposure'

describe('country exposure', () => {
  it('weights stocks and fund countries by current EUR value without redistributing unknown weight', () => {
    const result = countryExposure([{ symbol: 'STOCK', value: '100' }, { symbol: 'FUND', value: '200' }, { symbol: 'UNKNOWN', value: '100' }], {
      STOCK: { weights: { Germany: '100' }, source: 'Yahoo', asOf: '2026-10-01' },
      FUND: { weights: { Germany: '25', Japan: '50' }, source: 'justETF', asOf: null },
    })
    expect(result.countries).toEqual([
      { country: 'Germany', value: '150', percent: '37.5' },
      { country: 'Japan', value: '100', percent: '25' },
    ])
    expect(result.unknown).toEqual({ value: '150', percent: '37.5' })
    expect(result.total).toBe('400')
  })

  it('aggregates accounts, excludes unavailable and zero values, and handles an empty portfolio', () => {
    const data = { X: { weights: { Germany: '100' }, source: 'Yahoo', asOf: null } }
    expect(countryExposure([{ symbol: 'X', value: '0.1' }, { symbol: 'X', value: '0.2' }, { symbol: 'Y', value: null }, { symbol: 'Y', value: '0' }], data).countries).toEqual([{ country: 'Germany', value: '0.3', percent: '100' }])
    expect(countryExposure([], {}).unknown).toEqual({ value: '0', percent: '0' })
  })

  it('combines provider aliases under the map country name without losing value', () => {
    const result = countryExposure([{ symbol: 'FUND', value: '100' }], {
      FUND: { weights: { 'United States of America': '30', 'United States': '20', 'Czech Republic': '25', Singapore: '25' }, source: 'test', asOf: null },
    })
    expect(result.countries).toEqual([
      { country: 'United States', value: '50', percent: '50' },
      { country: 'Czechia', value: '25', percent: '25' },
      { country: 'Singapore', value: '25', percent: '25' },
    ])
    expect(result.unknown.value).toBe('0')
  })

  it('maps the Korea label used by fund issuers to the South Korea map shape', () => {
    const result = countryExposure([{ symbol: 'FUND', value: '100' }], { FUND: { weights: { Korea: '6.9', 'South Korea': '1.1' }, source: 'test', asOf: null } })
    expect(result.countries).toEqual([{ country: 'South Korea', value: '8', percent: '8' }])
  })

  it('scales compositions covering at least 95 percent up to 100 percent but never below that', () => {
    const at = (weights: Record<string, string>) => countryExposure([{ symbol: 'F', value: '100' }], { F: { weights, source: 'test', asOf: null } })
    expect(at({ Germany: '95' }).countries).toEqual([{ country: 'Germany', value: '100', percent: '100' }])
    expect(at({ Germany: '95' }).unknown.value).toBe('0')
    const scaled = at({ Germany: '47.5', Japan: '47.5' })
    expect(scaled.countries).toEqual([{ country: 'Germany', value: '50', percent: '50' }, { country: 'Japan', value: '50', percent: '50' }])
    const partial = at({ Germany: '94.99' })
    expect(partial.countries).toEqual([{ country: 'Germany', value: '94.99', percent: '94.99' }])
    expect(partial.unknown.value).toBe('5.01')
  })

  it('reports published weight coverage, summing aliases and ignoring zero weights', () => {
    expect(weightCoverage({ Germany: '40', 'United States of America': '30', 'United States': '20', Japan: '0' })).toBe('90')
    expect(weightCoverage({})).toBe('0')
  })

  it('does not assign countries that have zero weight', () => {
    expect(countryExposure([{ symbol: 'X', value: '10' }], { X: { weights: { Germany: '0' }, source: 'test', asOf: null } }).countries).toEqual([])
  })

  it('rejects country weights over 100 percent or negative weights instead of inventing exposure', () => {
    for (const weights of [{ Germany: '101' }, { Germany: '-1' }]) {
      expect(() => countryExposure([{ symbol: 'X', value: '10' }], { X: { weights, source: 'test', asOf: null } })).toThrow()
    }
  })
})

describe('stored composition check', () => {
  const usable: Record<string, string>[] = [{}, { Germany: '100' }, { Germany: '99.99' }, { Germany: '60.5', Japan: '39.5' }, { Germany: '0' }, { Germany: '33.333333', Japan: '33.333333', France: '33.333333' }]
  const unusable: [unknown, string][] = [
    [{ Germany: '101' }, 'more than 100%'],
    [{ Germany: '60', Japan: '40.01' }, 'more than 100%'],
    [{ Germany: '100', Japan: '0.000001' }, 'more than 100%'],
    ...['-1', 'abc', '', '1e2', 'NaN', ' 5', '5%', '.5', '5.', '1,5'].map((weight): [unknown, string] => [{ Germany: weight }, 'plain non-negative number']),
    [{ Germany: 25 }, 'plain non-negative number'],
    [{ Germany: null }, 'plain non-negative number'],
    [{ Germany: { raw: 25 } }, 'plain non-negative number'],
    ...[null, undefined, 'Germany', ['Germany'], 42].map((weights): [unknown, string] => [weights, 'not a list of countries']),
  ]

  it('accepts weights the exposure calculation can use', () => {
    for (const weights of usable) expect(compositionProblem(weights), JSON.stringify(weights)).toBeNull()
  })

  it('names why weights the calculation would reject cannot be used', () => {
    for (const [weights, reason] of unusable) expect(compositionProblem(weights), JSON.stringify(weights)).toContain(reason)
  })

  it('never accepts weights that make the strict calculation throw', () => {
    for (const weights of [...usable, ...unusable.map(([shape]) => shape)]) {
      if (compositionProblem(weights) === null) {
        expect(() => countryExposure([{ symbol: 'X', value: '10' }], { X: { weights: weights as Record<string, string>, source: 'test', asOf: null } }), JSON.stringify(weights)).not.toThrow()
      }
    }
  })

  it('holds for generated weights, with both accepted and rejected cases exercised', () => {
    let seed = 20261029
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    const junk = ['', 'abc', '-3', '1e2', 'NaN', ' 7', '5%', '.5', '5.', '1,5']
    let accepted = 0
    let rejected = 0
    for (let round = 0; round < 500; round += 1) {
      const weights: Record<string, string> = {}
      const countries = 1 + Math.floor(next() * 6)
      for (let country = 0; country < countries; country += 1) {
        weights[`Country ${country}`] = next() < 0.1 ? junk[Math.floor(next() * junk.length)] : (next() * 60).toFixed(Math.floor(next() * 7))
      }
      if (compositionProblem(weights) === null) {
        accepted += 1
        expect(() => countryExposure([{ symbol: 'X', value: '10' }], { X: { weights, source: 'test', asOf: null } }), JSON.stringify(weights)).not.toThrow()
      } else {
        rejected += 1
      }
    }
    expect(accepted).toBeGreaterThan(50)
    expect(rejected).toBeGreaterThan(50)
  })

  it('splits stored compositions into usable ones and named problems, leaving the input untouched', () => {
    const good = { weights: { Germany: '50' }, source: 'test', asOf: null }
    const input = { GOOD: good, OVER: { ...good, weights: { Germany: '101' } }, NULLED: { ...good, weights: null as unknown as Record<string, string> } }
    const result = usableCompositions(input)
    expect(result.usable).toEqual({ GOOD: good })
    expect(Object.keys(result.rejected)).toEqual(['OVER', 'NULLED'])
    expect(result.rejected.OVER).toContain('more than 100%')
    expect(Object.keys(input)).toEqual(['GOOD', 'OVER', 'NULLED'])
  })
})
