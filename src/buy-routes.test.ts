import { describe, expect, it } from 'vitest'
import type { Sql } from 'postgres'
import { signSession } from './auth'
import { createBuy, searchSymbolsRoute, quoteSymbolRoute } from './buy-routes'
import { createAccount, DuplicateTransactionError, addTransaction } from './ledger-entry'
import { readLedger } from './ledger-store'
import { withIsolatedDatabase } from './test-support/schema'

const secret = 's'.repeat(32)
const now = Date.UTC(2026, 5, 15, 12)
const session = `session=${signSession(secret, now, 60_000)}`
const origin = 'http://localhost:3000'

type Handler = (request: Request) => Response | Promise<Response>

type Routes = Record<string, { status?: number; body: unknown }>

function yahoo(routes: Routes) {
  const calls: URL[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    const route = routes[url.pathname]
    if (!route) throw new Error(`unexpected request ${url.pathname}`)
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }) as typeof fetch
  return { impl, calls }
}

const chart = (symbol: string, currency = 'USD', price: number | null = 100): Routes =>
  ({ [`/v8/finance/chart/${symbol}`]: { body: { chart: { result: [{ meta: { symbol, currency, regularMarketPrice: price ?? undefined, longName: `${symbol} Inc.` } }], error: null } } } })
const unknownSymbol = (symbol: string): Routes =>
  ({ [`/v8/finance/chart/${symbol}`]: { status: 404, body: { chart: { result: null, error: { code: 'Not Found', description: 'x' } } } } })
const search = (quotes: unknown[]): Routes => ({ '/v1/finance/search': { body: { quotes } } })

type Headers_ = Record<string, string | undefined>
const defined = (headers: Headers_) => Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined))
const get = (path: string, headers: Headers_ = { cookie: session }) =>
  new Request(`${origin}${path}`, { headers: defined(headers) })
const post = (body: unknown, headers: Headers_ = { cookie: session, origin, 'content-type': 'application/json' }) =>
  new Request(`${origin}/api/buys`, { method: 'POST', headers: defined(headers), body: typeof body === 'string' ? body : JSON.stringify(body) })

const buy = (accountId: string, change: Record<string, unknown> = {}) =>
  ({ accountId, symbol: 'AAPL', date: '2026-06-10', quantity: '2', unitPrice: '100.5', fee: '1', currency: 'USD', ...change })

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

describe('authentication', () => {
  const sql = null as unknown as Sql
  const handlers: [string, Handler][] = [
    ['search', (request) => searchSymbolsRoute(request, { secret, now, fetch: yahoo({}).impl })],
    ['quote', (request) => quoteSymbolRoute(request, { secret, now, fetch: yahoo({}).impl })],
    ['buy', (request) => createBuy(request, { secret, now, sql, fetch: yahoo({}).impl })],
  ]

  it.each(handlers)('%s refuses a request without a valid session and never calls Yahoo', async (name, handler) => {
    const headers = name === 'buy' ? { origin, 'content-type': 'application/json' } : {}
    const stale = { cookie: `session=${signSession(secret, now - 120_000, 60_000)}`, origin }
    for (const extra of [headers, { ...headers, cookie: 'session=forged' }, stale]) {
      const request = name === 'buy' ? post(buy('x'), extra) : get(name === 'search' ? '/api/symbols?q=apple' : '/api/symbols/quote?symbol=AAPL', extra)
      const response = await handler(request)
      expect(response.status).toBe(401)
      expect(await json(response)).toEqual({ error: 'Not signed in' })
    }
  })
})

describe('GET symbol search', () => {
  it('returns matches from Yahoo', async () => {
    const fake = yahoo(search([{ symbol: 'AAPL', longname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }]))
    const response = await searchSymbolsRoute(get('/api/symbols?q=apple'), { secret, now, fetch: fake.impl })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await json(response)).toEqual({ matches: [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' }] })
    expect(fake.calls[0].searchParams.get('q')).toBe('apple')
  })

  it('answers an empty or missing query with no matches and no Yahoo call', async () => {
    const fake = yahoo({})
    for (const path of ['/api/symbols', '/api/symbols?q=', '/api/symbols?q=%20%20']) {
      expect(await json(await searchSymbolsRoute(get(path), { secret, now, fetch: fake.impl }))).toEqual({ matches: [] })
    }
    expect(fake.calls).toHaveLength(0)
  })

  it('rejects over-long text with 400', async () => {
    const response = await searchSymbolsRoute(get(`/api/symbols?q=${'x'.repeat(65)}`), { secret, now, fetch: yahoo({}).impl })
    expect(response.status).toBe(400)
    expect((await json(response)).error).toMatch(/too long/)
  })

  it('reports an unavailable Yahoo as 502 with a plain message, not the internal error', async () => {
    const down = (async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443') }) as typeof fetch
    const response = await searchSymbolsRoute(get('/api/symbols?q=apple'), { secret, now, fetch: down })
    expect(response.status).toBe(502)
    expect(await json(response)).toEqual({ error: 'Yahoo Finance is not reachable right now' })
    const limited = await searchSymbolsRoute(get('/api/symbols?q=apple'), { secret, now, fetch: yahoo({ '/v1/finance/search': { status: 429, body: {} } }).impl })
    expect(limited.status).toBe(502)
  })
})

describe('GET symbol quote', () => {
  it('returns currency, price and name, and whether the currency can be recorded', async () => {
    const response = await quoteSymbolRoute(get('/api/symbols/quote?symbol=AAPL'), { secret, now, fetch: yahoo(chart('AAPL', 'USD', 347.5)).impl })
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({ symbol: 'AAPL', currency: 'USD', price: '347.5', name: 'AAPL Inc.', supported: true })
  })

  it('flags a currency the ledger cannot hold', async () => {
    const response = await quoteSymbolRoute(get('/api/symbols/quote?symbol=BARC.L'), { secret, now, fetch: yahoo(chart('BARC.L', 'GBp', 200)).impl })
    expect(await json(response)).toMatchObject({ currency: 'GBp', supported: false })
  })

  it('answers 404 for an unknown symbol and 400 for an invalid one', async () => {
    expect((await quoteSymbolRoute(get('/api/symbols/quote?symbol=NOPE'), { secret, now, fetch: yahoo(unknownSymbol('NOPE')).impl })).status).toBe(404)
    const fake = yahoo({})
    for (const path of ['/api/symbols/quote', '/api/symbols/quote?symbol=', '/api/symbols/quote?symbol=A%20B', '/api/symbols/quote?symbol=..%2Fx']) {
      expect((await quoteSymbolRoute(get(path), { secret, now, fetch: fake.impl })).status).toBe(400)
    }
    expect(fake.calls).toHaveLength(0)
  })

  it('reports an unavailable Yahoo as 502', async () => {
    const down = (async () => { throw new Error('offline') }) as typeof fetch
    expect((await quoteSymbolRoute(get('/api/symbols/quote?symbol=AAPL'), { secret, now, fetch: down })).status).toBe(502)
  })
})

describe('POST buy', () => {
  async function run(change: Record<string, unknown> | ((accountId: string) => unknown), setup?: (sql: Sql, accountId: string) => Promise<void>, routes: Routes = chart('AAPL')) {
    return withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      await setup?.(sql, id)
      const body = typeof change === 'function' ? change(id) : buy(id, change)
      const response = await createBuy(post(body), { secret, now, sql, fetch: yahoo(routes).impl })
      return { response, payload: await json(response), ledger: await readLedger(sql), accountId: id, sql }
    })
  }

  it('saves a buy, normalising the symbol, and says the price is still missing', async () => {
    const { response, payload, ledger, accountId } = await run({ symbol: 'AAPL', comment: 'first lot' })
    expect(response.status).toBe(201)
    expect(payload).toEqual({ id: ledger.activities[0].id, priced: false })
    expect(ledger.activities).toHaveLength(1)
    expect(ledger.activities[0]).toMatchObject({ accountId, type: 'BUY', symbol: 'AAPL', quantity: '2', unitPrice: '100.5', fee: '1', currency: 'USD',
      date: '2026-06-10T00:00:00.000Z', comment: 'first lot' })
  })

  it('says the price is known when the worker has already cached one', async () => {
    const { payload } = await run({}, async (sql) => {
      await sql`CREATE TABLE security_quotes (symbol text, observed_on date, price numeric, currency text, source text, fetched_at timestamptz)`
      await sql`INSERT INTO security_quotes VALUES ('AAPL', '2026-06-12', 5, 'USD', 'yfinance', now())`
    })
    expect(payload).toMatchObject({ priced: true })
  })

  it('treats a second purchase of the same symbol as an increase of the position', async () => {
    const { ledger } = await run({ date: '2026-06-11', quantity: '3' }, async (sql, accountId) => {
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-06-01', currency: 'USD', symbol: 'AAPL', quantity: '1', unitPrice: '90' })
    })
    expect(ledger.activities.map((activity) => [activity.symbol, activity.quantity])).toEqual([['AAPL', '1'], ['AAPL', '3']])
  })

  it('defaults the fee to zero and the comment to none', async () => {
    const { ledger } = await run((accountId) => ({ accountId, symbol: 'AAPL', date: '2026-06-10', quantity: '1', unitPrice: '5', currency: 'EUR' }))
    expect(ledger.activities[0]).toMatchObject({ fee: '0', comment: null, currency: 'EUR' })
  })

  it('rejects a foreign or missing origin with 403 and saves nothing', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      for (const headers of [{ cookie: session, origin: 'http://evil.example', 'content-type': 'application/json' }, { cookie: session, 'content-type': 'application/json' }]) {
        const response = await createBuy(post(buy(id), headers), { secret, now, sql, fetch: yahoo(chart('AAPL')).impl })
        expect(response.status).toBe(403)
      }
      expect((await readLedger(sql)).activities).toHaveLength(0)
    })
  })

  it('rejects a symbol Yahoo does not know with 400 and saves nothing', async () => {
    const { response, payload, ledger } = await run({ symbol: 'NOPE' }, undefined, unknownSymbol('NOPE'))
    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/NOPE.*not found on Yahoo/i)
    expect(ledger.activities).toHaveLength(0)
  })

  it('rejects a symbol Yahoo prices in a currency the ledger cannot hold', async () => {
    const { response, payload } = await run({ symbol: 'BARC.L', currency: 'EUR' }, undefined, chart('BARC.L', 'GBp'))
    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/GBp.*EUR and USD/)
  })

  it('lets a EUR purchase of a USD-quoted instrument through, since the broker converted it', async () => {
    const { response, ledger } = await run({ currency: 'EUR' })
    expect(response.status).toBe(201)
    expect(ledger.activities[0].currency).toBe('EUR')
  })

  it('fails closed with 502 when Yahoo cannot confirm the symbol', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      const down = (async () => { throw new Error('offline') }) as typeof fetch
      const response = await createBuy(post(buy(id)), { secret, now, sql, fetch: down })
      expect(response.status).toBe(502)
      expect((await readLedger(sql)).activities).toHaveLength(0)
    })
  })

  it.each([
    ['a missing account', { accountId: '00000000-0000-0000-0000-000000000000' }, /Account not found/],
    ['a zero quantity', { quantity: '0' }, /Invalid quantity/],
    ['exponent notation', { quantity: '1e3' }, /Invalid quantity/],
    ['a negative price', { unitPrice: '-5' }, /Invalid unit price/],
    ['a negative fee', { fee: '-1' }, /Invalid fee/],
    ['an unsupported currency', { currency: 'GBP' }, /Unsupported currency/],
    ['an impossible date', { date: '2026-02-30' }, /Invalid date/],
  ])('rejects %s with 400 and the reason', async (_name, change, message) => {
    const { response, payload, ledger } = await run(change)
    expect(response.status).toBe(400)
    expect(payload.error).toMatch(message)
    expect(ledger.activities).toHaveLength(0)
  })

  it('rejects a date after today, but accepts today', async () => {
    expect((await run({ date: '2026-06-16' })).response.status).toBe(400)
    expect((await run({ date: '2026-06-15' })).response.status).toBe(201)
    const future = await run({ date: '2030-01-01' })
    expect(future.payload.error).toMatch(/future/i)
  })

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a missing symbol', (accountId: string) => ({ ...buy(accountId), symbol: undefined })],
    ['a numeric quantity', (accountId: string) => ({ ...buy(accountId), quantity: 2 })],
    ['a numeric account', () => ({ ...buy('x'), accountId: 7 })],
    ['a non-boolean force', (accountId: string) => ({ ...buy(accountId), force: 'yes' })],
  ])('rejects %s with 400 and does not call Yahoo', async (_name, body) => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      const fake = yahoo({})
      const response = await createBuy(post(typeof body === 'function' ? body(id) : body), { secret, now, sql, fetch: fake.impl })
      expect(response.status).toBe(400)
      expect(fake.calls).toHaveLength(0)
      expect((await readLedger(sql)).activities).toHaveLength(0)
    })
  })

  describe('duplicates', () => {
    const existing = async (sql: Sql, accountId: string) => {
      await addTransaction(sql, { accountId, type: 'BUY', date: '2026-06-10', currency: 'USD', symbol: 'AAPL', quantity: '2', unitPrice: '100.5', fee: '1' })
    }

    it('answers 409 with a duplicate marker, and saves nothing', async () => {
      const { response, payload, ledger } = await run({}, existing)
      expect(response.status).toBe(409)
      expect(payload).toMatchObject({ duplicate: true })
      expect(payload.error).toMatch(/Duplicate transaction/)
      expect(ledger.activities).toHaveLength(1)
    })

    it('saves the repeat when the person confirms with force', async () => {
      const { response, ledger } = await run({ force: true }, existing)
      expect(response.status).toBe(201)
      expect(ledger.activities).toHaveLength(2)
    })
  })

  it('does not leak database errors', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      await sql.unsafe('ALTER TABLE transactions ADD CONSTRAINT no_rows CHECK (false) NOT VALID')
      const response = await createBuy(post(buy(id)), { secret, now, sql, fetch: yahoo(chart('AAPL')).impl })
      expect(response.status).toBe(500)
      expect(await json(response)).toEqual({ error: 'The buy could not be saved' })
    })
  })
})

describe('DuplicateTransactionError', () => {
  it('is what addTransaction throws for a repeat', async () => {
    await withIsolatedDatabase(async (sql) => {
      const { id: accountId } = await createAccount(sql, { name: 'Broker', currency: 'EUR' })
      const entry = { accountId, type: 'BUY', date: '2026-06-10', currency: 'EUR', symbol: 'X', quantity: '1', unitPrice: '1' }
      await addTransaction(sql, entry)
      await expect(addTransaction(sql, entry)).rejects.toBeInstanceOf(DuplicateTransactionError)
    })
  })
})
