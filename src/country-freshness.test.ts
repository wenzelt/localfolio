import { describe, expect, it } from 'vitest'
import { compositionFreshness } from './country-freshness'

describe('country composition freshness', () => {
  it('keeps a source current through 90 UTC calendar days', () => {
    expect(compositionFreshness('2026-01-01', new Date('2026-04-01T23:59:59.999Z'))).toBe('current')
  })

  it('marks a source stale after 91 UTC calendar days', () => {
    expect(compositionFreshness('2026-01-01', new Date('2026-04-02T00:00:00.000Z'))).toBe('stale')
  })

  it('uses the UTC day of now rather than its local offset', () => {
    expect(compositionFreshness('2026-01-01', new Date('2026-04-01T23:30:00-02:00'))).toBe('stale')
    expect(compositionFreshness('2026-01-01', new Date('2026-04-02T00:30:00+02:00'))).toBe('current')
  })

  it('reports an unknown source age when its date is missing', () => {
    expect(compositionFreshness(null, new Date('2026-04-02T00:00:00.000Z'))).toBe('unknown')
    expect(compositionFreshness(undefined, new Date('2026-04-02T00:00:00.000Z'))).toBe('unknown')
  })
})
