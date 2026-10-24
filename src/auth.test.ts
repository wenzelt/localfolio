import { describe, expect, it } from 'vitest'
import { passwordMatches, signSession, verifySession } from './auth'

const secret = 'a'.repeat(32)
const now = Date.UTC(2025, 5, 1)
const day = 24 * 60 * 60 * 1000

describe('password check', () => {
  it('accepts only the exact password', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true)
    expect(passwordMatches('correct horsf', 'correct horse')).toBe(false)
    expect(passwordMatches('correct', 'correct horse')).toBe(false)
    expect(passwordMatches('', 'correct horse')).toBe(false)
  })

  it('rejects every input when no password is configured', () => {
    expect(passwordMatches('', '')).toBe(false)
    expect(passwordMatches('anything', '')).toBe(false)
  })
})

describe('session token', () => {
  it('is valid until it expires and not afterwards', () => {
    const token = signSession(secret, now, day)
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/)
    expect(verifySession(secret, token, now)).toBe(true)
    expect(verifySession(secret, token, now + day - 1)).toBe(true)
    expect(verifySession(secret, token, now + day)).toBe(false)
  })

  it('rejects a changed expiry, a changed signature or another secret', () => {
    const [expires, signature] = signSession(secret, now, day).split('.')
    expect(verifySession(secret, `${Number(expires) + day}.${signature}`, now)).toBe(false)
    expect(verifySession(secret, `${expires}.${'0'.repeat(64)}`, now)).toBe(false)
    expect(verifySession('b'.repeat(32), `${expires}.${signature}`, now)).toBe(false)
  })

  it('rejects missing or malformed tokens', () => {
    for (const token of [undefined, '', 'abc', '.', '1.', 'x.' + '0'.repeat(64), '-5.' + '0'.repeat(64)]) {
      expect(verifySession(secret, token, now)).toBe(false)
    }
  })

  it('refuses a secret shorter than 32 characters', () => {
    expect(() => signSession('short', now, day)).toThrow('SESSION_SECRET must be at least 32 characters')
    expect(() => verifySession('short', 'x', now)).toThrow('SESSION_SECRET must be at least 32 characters')
  })
})
