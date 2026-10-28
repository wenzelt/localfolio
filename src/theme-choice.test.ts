import { describe, expect, it } from 'vitest'
import { chooseTheme, parseTheme, THEMES } from './theme-choice'

const post = (theme: string, headers: Record<string, string> = {}, url = 'http://localhost:3000/theme') => {
  const body = new URLSearchParams({ theme })
  return new Request(url, { method: 'POST', body, headers: { origin: new URL(url).origin, ...headers } })
}

describe('reading the saved theme', () => {
  it('offers the ledger first, the vaporwave second and the pop art stars and stripes third', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(['ledger', 'vaporwave', 'popart'])
  })

  it('describes the pop art theme without naming anyone', () => {
    const popart = THEMES.find((theme) => theme.id === 'popart')
    expect(popart).toMatchObject({ name: 'Pop Art', note: 'Stars and stripes, always bright' })
  })

  it('defaults to the ledger', () => {
    expect(parseTheme(null)).toBe('ledger')
    expect(parseTheme('session=x')).toBe('ledger')
  })

  it('reads the theme cookie among others and ignores unknown values', () => {
    expect(parseTheme('session=x; theme=vaporwave; view_hide=0')).toBe('vaporwave')
    expect(parseTheme('theme=ledger')).toBe('ledger')
    expect(parseTheme('a=b; theme=popart')).toBe('popart')
    expect(parseTheme('theme=hotdog')).toBe('ledger')
  })
})

describe('choosing a theme', () => {
  it('saves the choice for a year and goes back to the page it was chosen on', async () => {
    const response = await chooseTheme(post('vaporwave', { referer: 'http://localhost:3000/?period=1Y&hide=1' }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/?period=1Y&hide=1')
    expect(response.headers.get('set-cookie')).toBe('theme=vaporwave; Max-Age=31536000; Path=/; SameSite=Lax')
  })

  it('marks the cookie Secure over https', async () => {
    const url = 'https://portfolio.example/theme'
    const response = await chooseTheme(post('ledger', { referer: 'https://portfolio.example/' }, url))
    expect(response.headers.get('set-cookie')).toMatch(/; Secure$/)
  })

  it('returns home when the referrer is missing, foreign or unreadable, so the redirect is never open', async () => {
    for (const referer of [undefined, 'https://evil.example/steal', 'not a url', 'http://localhost:3000//evil.example/x']) {
      const response = await chooseTheme(post('vaporwave', referer ? { referer } : {}))
      expect(response.headers.get('location')).toBe('/')
    }
  })

  it('rejects a foreign origin and an unknown theme without setting a cookie', async () => {
    const foreign = await chooseTheme(post('vaporwave', { origin: 'https://evil.example' }))
    expect(foreign.status).toBe(403)
    const unknown = await chooseTheme(post('hotdog'))
    expect(unknown.status).toBe(400)
    expect(foreign.headers.get('set-cookie')).toBeNull()
    expect(unknown.headers.get('set-cookie')).toBeNull()
  })
})
