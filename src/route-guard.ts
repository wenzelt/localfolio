import { authenticated, sameOrigin } from './web-auth'

export type Session = { secret: string; now: number }

// Every API answer belongs to the signed-in owner, so none may be cached.
export const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

// The answer that refuses the request, or null to go on. Every route needs a session. A write also needs a request
// from this origin, so another site cannot send one with the owner's cookie.
export function refuse(request: Request, { secret, now }: Session, { write }: { write: boolean }): Response | null {
  if (!authenticated(request.headers.get('cookie'), secret, now)) return reply(401, { error: 'Not signed in' })
  if (write && !sameOrigin(request)) return reply(403, { error: 'Forbidden' })
  return null
}

// The body as text, read no further than `limit` bytes, so a client that omits Content-Length cannot send an endless
// upload. Null when the body is longer than that.
export async function boundedText(body: ReadableStream<Uint8Array>, limit: number): Promise<string | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) return Buffer.concat(chunks).toString('utf8')
    size += value.length
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
}
