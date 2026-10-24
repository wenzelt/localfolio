import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function passwordMatches(input: string, expected: string): boolean {
  return expected !== '' && timingSafeEqual(digest(input), digest(expected))
}

function checked(secret: string): string {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return secret
}

const sign = (secret: string, expires: string) => createHmac('sha256', secret).update(expires).digest('hex')

export function signSession(secret: string, nowMs: number, ttlMs: number): string {
  const expires = String(nowMs + ttlMs)
  return `${expires}.${sign(checked(secret), expires)}`
}

export function verifySession(secret: string, token: string | undefined, nowMs: number): boolean {
  checked(secret)
  const match = /^(\d+)\.([0-9a-f]{64})$/.exec(token ?? '')
  if (match === null) return false
  const [, expires, signature] = match
  return timingSafeEqual(Buffer.from(sign(secret, expires)), Buffer.from(signature)) && nowMs < Number(expires)
}
