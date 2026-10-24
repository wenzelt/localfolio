import { describe, expect, it } from 'vitest'
import { authenticated, login, logout } from './web-auth'

const config = { password: 'synthetic-password', secret: 's'.repeat(32) }
const now = Date.UTC(2026, 0, 1)
const request = (password: string, origin = 'http://localhost:3000') => new Request('http://localhost:3000/login', {
  method: 'POST', headers: { origin }, body: new URLSearchParams({ password }),
})

describe('web authentication', () => {
  it('sets an expiring HttpOnly cookie after a correct password', async () => {
    const response = await login(request(config.password), config, now)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly; SameSite=Strict; Path=/; Max-Age=86400')
    expect(cookie).not.toContain('Secure')
    expect(authenticated(cookie.split(';')[0], config.secret, now)).toBe(true)
    expect(authenticated(cookie.split(';')[0], config.secret, now + 86400000)).toBe(false)
    expect(authenticated(cookie.split(';')[0] + 'x', config.secret, now)).toBe(false)
  })

  it('rejects incorrect passwords without a session', async () => {
    const response = await login(request('wrong'), config, now)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/login?error=1')
    expect(response.headers.has('set-cookie')).toBe(false)
  })

  it('rejects foreign or missing origins on login and logout', async () => {
    for (const origin of ['http://evil.example', '']) {
      expect((await login(request(config.password, origin), config, now)).status).toBe(403)
      expect(logout(request('', origin)).status).toBe(403)
    }
  })

  it('fails closed without configured credentials', async () => {
    await expect(login(request(''), { ...config, password: '' }, now)).rejects.toThrow('APP_PASSWORD')
    await expect(login(request(config.password), { ...config, secret: '' }, now)).rejects.toThrow('SESSION_SECRET')
  })

  it('reads the session cookie among other cookies and rejects missing sessions', async () => {
    const response = await login(request(config.password), config, now)
    expect(authenticated(`other=x; ${response.headers.get('set-cookie')!.split(';')[0]}`, config.secret, now)).toBe(true)
    expect(authenticated(null, config.secret, now)).toBe(false)
    expect(authenticated('session=garbage', config.secret, now)).toBe(false)
  })

  it('accepts the incoming host when Next uses an internal URL hostname', async () => {
    const req = new Request('http://localhost:3100/login/submit', {
      method: 'POST', headers: { origin: 'http://192.168.1.10:3100', host: '192.168.1.10:3100' },
      body: new URLSearchParams({ password: config.password }),
    })
    expect((await login(req, config, now)).status).toBe(303)
  })

  it('clears the cookie on logout', () => {
    const response = logout(request(''))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/login')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('marks cookies Secure on HTTPS', async () => {
    const req = new Request('https://portfolio.example/login', {
      method: 'POST', headers: { origin: 'https://portfolio.example' }, body: new URLSearchParams({ password: config.password }),
    })
    expect((await login(req, config, now)).headers.get('set-cookie')).toContain('; Secure')
    expect(logout(req).headers.get('set-cookie')).toContain('; Secure')
  })
})
