import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDate } from './local-date'

afterEach(() => vi.unstubAllEnvs())

describe("the owner's date", () => {
  it('is the calendar day in the IANA time zone named by TZ', () => {
    const lateEveningUtc = Date.UTC(2026, 0, 1, 23, 30)
    vi.stubEnv('TZ', 'Asia/Tokyo')
    expect(localDate(lateEveningUtc)).toBe('2026-01-02')
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(localDate(lateEveningUtc)).toBe('2026-01-01')
    expect(localDate(Date.UTC(2026, 0, 2, 3, 0))).toBe('2026-01-01')
  })

  it('is the UTC day when TZ is unset or empty, as before', () => {
    vi.stubEnv('TZ', '')
    expect(localDate(Date.UTC(2026, 0, 1, 23, 30))).toBe('2026-01-01')
  })

  it('names the setting when TZ is not an IANA time zone', () => {
    vi.stubEnv('TZ', 'Mars/Olympus_Mons')
    expect(() => localDate(Date.UTC(2026, 0, 1))).toThrow('TZ must be an IANA time zone such as America/New_York, not Mars/Olympus_Mons')
  })
})

describe('code that needs today', () => {
  const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return name === 'test-support' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })

  it('takes it from localDate, not from the UTC clock', () => {
    const root = new URL('..', import.meta.url).pathname
    const utcToday = /new Date\((?:[^()]*now[^()]*)?\)\.toISOString\(\)\.slice\(0, 10\)/i
    const offenders = [...sources(join(root, 'app')), ...sources(join(root, 'src'))]
      .filter((path) => utcToday.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(root.length))
    expect(offenders).toEqual([])
  })
})
