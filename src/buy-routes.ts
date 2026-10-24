import type { Sql } from 'postgres'
import { addTransaction, DuplicateTransactionError, hasCachedPrice } from './ledger-entry'
import { quoteSymbol, searchSymbols } from './yahoo'
import { authenticated, sameOrigin } from './web-auth'

type Deps = { secret: string; now: number; fetch?: typeof fetch; yahooBase?: string }
const recordable = ['EUR', 'USD']
const headers = { 'cache-control': 'no-store' }

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => reply({ error, ...extra }, status)
const unreachable = () => fail(502, 'Yahoo Finance is not reachable right now')
const signedIn = (request: Request, deps: Deps) => authenticated(request.headers.get('cookie'), deps.secret, deps.now)

// Messages from the Yahoo client that describe the person's input rather than an outage.
const inputProblem = (error: unknown) => error instanceof Error && /^(Search text is too long|Invalid symbol)/.test(error.message)

export async function searchSymbolsRoute(request: Request, deps: Deps): Promise<Response> {
  if (!signedIn(request, deps)) return fail(401, 'Not signed in')
  try {
    const matches = await searchSymbols(new URL(request.url).searchParams.get('q') ?? '', deps.fetch, deps.yahooBase)
    return reply({ matches })
  } catch (error) {
    return inputProblem(error) ? fail(400, (error as Error).message) : unreachable()
  }
}

export async function quoteSymbolRoute(request: Request, deps: Deps): Promise<Response> {
  if (!signedIn(request, deps)) return fail(401, 'Not signed in')
  const symbol = new URL(request.url).searchParams.get('symbol') ?? ''
  try {
    const quote = await quoteSymbol(symbol, deps.fetch, deps.yahooBase)
    if (quote === null) return fail(404, `${symbol} was not found on Yahoo Finance`)
    return reply({ ...quote, supported: recordable.includes(quote.currency) })
  } catch (error) {
    return inputProblem(error) ? fail(400, (error as Error).message) : unreachable()
  }
}

const required = ['accountId', 'symbol', 'date', 'quantity', 'unitPrice', 'currency'] as const
const optional = ['fee', 'comment'] as const

function parseBuy(text: string) {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const fields = body as Record<string, unknown>
  if (required.some((name) => typeof fields[name] !== 'string')) return null
  if (optional.some((name) => fields[name] !== undefined && typeof fields[name] !== 'string')) return null
  if (fields.force !== undefined && typeof fields.force !== 'boolean') return null
  return fields as Record<(typeof required)[number], string> & { fee?: string; comment?: string; force?: boolean }
}

export async function createBuy(request: Request, deps: Deps & { sql: Sql }): Promise<Response> {
  if (!signedIn(request, deps)) return fail(401, 'Not signed in')
  if (!sameOrigin(request)) return fail(403, 'Forbidden')
  const buy = parseBuy(await request.text())
  if (buy === null) return fail(400, 'The buy form could not be read')
  const symbol = buy.symbol.trim()
  if (buy.date.slice(0, 10) > new Date(deps.now).toISOString().slice(0, 10)) return fail(400, 'A buy cannot be dated in the future')
  // Checked against Yahoo again here, so a mistyped or forged symbol cannot create a position the worker could never price.
  let quote: Awaited<ReturnType<typeof quoteSymbol>>
  try {
    quote = await quoteSymbol(symbol, deps.fetch, deps.yahooBase)
  } catch (error) {
    return inputProblem(error) ? fail(400, (error as Error).message) : unreachable()
  }
  if (quote === null) return fail(400, `${symbol} was not found on Yahoo Finance`)
  if (!recordable.includes(quote.currency)) return fail(400, `${symbol} is quoted in ${quote.currency}; only EUR and USD can be recorded`)
  try {
    const { id } = await addTransaction(deps.sql, {
      accountId: buy.accountId, type: 'BUY', date: buy.date, currency: buy.currency, symbol,
      quantity: buy.quantity, unitPrice: buy.unitPrice, fee: buy.fee, comment: buy.comment, force: buy.force,
    })
    return reply({ id, priced: await hasCachedPrice(deps.sql, symbol) }, 201)
  } catch (error) {
    if (error instanceof DuplicateTransactionError) return fail(409, error.message, { duplicate: true })
    // Validation problems are plain errors; database errors carry a code and stay out of the response.
    if (error instanceof Error && !('code' in error)) return fail(400, error.message)
    return fail(500, 'The buy could not be saved')
  }
}
