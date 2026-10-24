import { passwordMatches, signSession, verifySession } from './auth'

const ttl = 86400

export function sameOrigin(request: Request): boolean {
  const url = new URL(request.url)
  const host = request.headers.get('host') ?? url.host
  return request.headers.get('origin') === `${url.protocol}//${host}`
}

function cookie(request: Request, token: string, maxAge: number): string {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

export function authenticated(cookies: string | null, secret: string, now: number): boolean {
  const token = cookies?.split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8)
  return verifySession(secret, token, now)
}

export async function login(request: Request, config: { password: string; secret: string }, now: number): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 })
  if (!config.password) throw new Error('APP_PASSWORD must be configured')
  if (config.secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  const form = await request.formData()
  const password = form.get('password')
  if (typeof password !== 'string' || !passwordMatches(password, config.password)) {
    return new Response(null, { status: 303, headers: { location: '/login?error=1' } })
  }
  return new Response(null, { status: 303, headers: {
    location: '/', 'set-cookie': cookie(request, signSession(config.secret, now, ttl * 1000), ttl),
  } })
}

export function logout(request: Request): Response {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 })
  return new Response(null, { status: 303, headers: { location: '/login', 'set-cookie': cookie(request, '', 0) } })
}
