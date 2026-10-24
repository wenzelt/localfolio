import { describe, expect, it } from 'vitest'
import { preferenceCookies, resolveViewPreferences, savePreferences } from './view-preferences'

describe('resolving view preferences', () => {
  it('defaults to MAX with values shown', () => {
    expect(resolveViewPreferences({}, null)).toEqual({ period: 'MAX', hidden: false })
  })

  it('uses the saved cookies when the URL is silent', () => {
    expect(resolveViewPreferences({}, 'session=x; view_period=YTD; view_hide=1')).toEqual({ period: 'YTD', hidden: true })
  })

  it('prefers explicit URL values over cookies, including hide=0 to show', () => {
    const cookies = 'view_period=YTD; view_hide=1'
    expect(resolveViewPreferences({ period: '1Y', hide: '0' }, cookies)).toEqual({ period: '1Y', hidden: false })
    expect(resolveViewPreferences({ hide: '1' }, 'view_hide=0')).toEqual({ period: 'MAX', hidden: true })
  })

  it('treats an explicit invalid or retired period as MAX instead of the saved cookie', () => {
    expect(resolveViewPreferences({ period: 'nope' }, 'view_period=MTD').period).toBe('MAX')
    expect(resolveViewPreferences({ period: '1D' }, 'view_period=1Y').period).toBe('MAX')
    expect(resolveViewPreferences({ period: '' }, 'view_period=1Y').period).toBe('MAX')
  })

  it('falls through an invalid hide value to the cookie, then the default', () => {
    expect(resolveViewPreferences({ hide: 'maybe' }, 'view_hide=1').hidden).toBe(true)
    expect(resolveViewPreferences({ hide: 'maybe' }, 'view_hide=2').hidden).toBe(false)
    expect(resolveViewPreferences({}, 'view_period=bad').period).toBe('MAX')
  })

  it('falls back to MAX for the retired 1D period from the cookie', () => {
    expect(resolveViewPreferences({}, 'view_period=1D').period).toBe('MAX')
  })
})

describe('saving view preferences', () => {
  it('builds one-year, lax, site-wide cookies and marks them Secure on HTTPS', () => {
    expect(preferenceCookies({ period: 'YTD', hidden: true }, true)).toEqual([
      'view_period=YTD; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
      'view_hide=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
    ])
    expect(preferenceCookies({ hidden: false }, false)).toEqual(['view_hide=0; Max-Age=31536000; Path=/; SameSite=Lax'])
  })

  it('writes each cookie to the document', () => {
    const writes: string[] = []
    const page = { set cookie(value: string) { writes.push(value) } }
    savePreferences({ period: 'MAX', hidden: false }, page, 'https:')
    expect(writes).toEqual([
      'view_period=MAX; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
      'view_hide=0; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
    ])
    writes.length = 0
    savePreferences({ period: 'MTD' }, page, 'http:')
    expect(writes).toEqual(['view_period=MTD; Max-Age=31536000; Path=/; SameSite=Lax'])
  })
})
