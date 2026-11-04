import { describe, expect, it } from 'vitest'
import { signSession } from './auth'
import { boundedText, refuse } from './route-guard'

const secret = 'g'.repeat(32)
const now = Date.UTC(2026, 0, 2)
const cookie = `session=${signSession(secret, now, 60_000)}`
const request = (headers: Record<string, string>) => new Request('http://localhost/api/example', { headers })

describe('refusing a request', () => {
  it('needs a session for reads and writes alike', async () => {
    for (const write of [false, true]) {
      const refused = refuse(request({ origin: 'http://localhost' }), { secret, now }, { write })
      expect(refused?.status).toBe(401)
      expect(refused?.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('needs this origin only for writes', () => {
    expect(refuse(request({ cookie }), { secret, now }, { write: false })).toBeNull()
    expect(refuse(request({ cookie }), { secret, now }, { write: true })?.status).toBe(403)
    expect(refuse(request({ cookie, origin: 'http://evil.test' }), { secret, now }, { write: true })?.status).toBe(403)
    expect(refuse(request({ cookie, origin: 'http://localhost' }), { secret, now }, { write: true })).toBeNull()
  })
})

describe('reading a bounded body', () => {
  const body = (text: string) => new Request('http://localhost', { method: 'POST', body: text }).body as ReadableStream<Uint8Array>

  it('returns the text up to the limit, counted in bytes', async () => {
    expect(await boundedText(body('€€'), 6)).toBe('€€')
    expect(await boundedText(body('€€'), 5)).toBeNull()
  })
})
