import type { Sql } from 'postgres'

const headers = { 'cache-control': 'no-store' }

// Unauthenticated by design (container probes), so it reveals only ok/unavailable, never error detail.
export async function healthResponse(sql: Sql, timeoutMs = 3000): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      sql`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) }),
    ])
    return Response.json({ status: 'ok' }, { headers })
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers })
  } finally {
    clearTimeout(timer)
  }
}
