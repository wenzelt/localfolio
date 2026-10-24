import { describe, expect, it } from 'vitest'
import { quoteSymbol, searchSymbols } from './yahoo'

type Reply = { status?: number; body?: unknown; text?: string }

function fakeFetch(reply: Reply) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init })
    const status = reply.status ?? 200
    return new Response(reply.text ?? JSON.stringify(reply.body), { status })
  }) as typeof fetch
  return { impl, calls }
}

const hit = (symbol: string, extra: Record<string, unknown> = {}) =>
  ({ symbol, shortname: `${symbol} Short`, longname: `${symbol} Long`, exchDisp: 'NASDAQ', exchange: 'NMS', quoteType: 'EQUITY', ...extra })

describe('searchSymbols', () => {
  it('maps hits to symbol, long name, exchange and type', async () => {
    const { impl } = fakeFetch({ body: { quotes: [hit('AAPL'), hit('VWCE.DE', { quoteType: 'ETF', exchDisp: 'XETRA' })] } })
    expect(await searchSymbols('apple', impl)).toEqual([
      { symbol: 'AAPL', name: 'AAPL Long', exchange: 'NASDAQ', type: 'EQUITY' },
      { symbol: 'VWCE.DE', name: 'VWCE.DE Long', exchange: 'XETRA', type: 'ETF' },
    ])
  })

  it('asks Yahoo for quotes only, url-encodes the text and sends a user agent', async () => {
    const { impl, calls } = fakeFetch({ body: { quotes: [] } })
    await searchSymbols('  s&p 500/etf  ', impl)
    const [{ url, init }] = calls
    expect(url.origin + url.pathname).toBe('https://query1.finance.yahoo.com/v1/finance/search')
    expect(url.searchParams.get('q')).toBe('s&p 500/etf')
    expect(url.searchParams.get('newsCount')).toBe('0')
    expect(url.searchParams.get('listsCount')).toBe('0')
    expect(new Headers(init?.headers).get('user-agent')).toBeTruthy()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back to the short name, then the symbol, and to the raw exchange code', async () => {
    const { impl } = fakeFetch({ body: { quotes: [
      hit('A', { longname: undefined }), hit('B', { longname: undefined, shortname: undefined, exchDisp: undefined }),
    ] } })
    expect(await searchSymbols('x', impl)).toEqual([
      { symbol: 'A', name: 'A Short', exchange: 'NASDAQ', type: 'EQUITY' },
      { symbol: 'B', name: 'B', exchange: 'NMS', type: 'EQUITY' },
    ])
  })

  it('keeps only things that can be bought: equities, ETFs and funds', async () => {
    const { impl } = fakeFetch({ body: { quotes: [
      hit('FUT=F', { quoteType: 'FUTURE' }), hit('^GSPC', { quoteType: 'INDEX' }), hit('FUND', { quoteType: 'MUTUALFUND' }),
      hit('EUR=X', { quoteType: 'CURRENCY' }), hit('ETF', { quoteType: 'ETF' }), hit('STOCK'),
    ] } })
    expect((await searchSymbols('x', impl)).map((match) => match.symbol)).toEqual(['FUND', 'ETF', 'STOCK'])
  })

  it('skips malformed hits instead of failing', async () => {
    const { impl } = fakeFetch({ body: { quotes: [null, 'x', { quoteType: 'EQUITY' }, { symbol: 7, quoteType: 'EQUITY' }, hit('OK')] } })
    expect((await searchSymbols('x', impl)).map((match) => match.symbol)).toEqual(['OK'])
  })

  it.each(['', '   '])('returns nothing for %j without calling Yahoo', async (text) => {
    const { impl, calls } = fakeFetch({ body: { quotes: [hit('AAPL')] } })
    expect(await searchSymbols(text, impl)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('rejects text longer than 64 characters without calling Yahoo', async () => {
    const { impl, calls } = fakeFetch({ body: { quotes: [] } })
    await expect(searchSymbols('x'.repeat(65), impl)).rejects.toThrow(/too long/)
    expect(calls).toHaveLength(0)
  })

  it('reports an unsuccessful or unreadable answer', async () => {
    await expect(searchSymbols('x', fakeFetch({ status: 429, body: {} }).impl)).rejects.toThrow(/Yahoo search failed \(429\)/)
    await expect(searchSymbols('x', fakeFetch({ text: '<html>' }).impl)).rejects.toThrow(/Yahoo search/)
    await expect(searchSymbols('x', fakeFetch({ body: { quotes: 'nope' } }).impl)).rejects.toThrow(/Yahoo search/)
  })

  it('lets a network failure through', async () => {
    const failing = (async () => { throw new Error('offline') }) as typeof fetch
    await expect(searchSymbols('x', failing)).rejects.toThrow('offline')
  })

  it('honours YAHOO_BASE_URL', async () => {
    const { impl, calls } = fakeFetch({ body: { quotes: [] } })
    await searchSymbols('x', impl, 'http://127.0.0.1:9999')
    expect(calls[0].url.origin).toBe('http://127.0.0.1:9999')
  })
})

const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } })

describe('quoteSymbol', () => {
  it('returns currency, last price and name', async () => {
    const { impl, calls } = fakeFetch({ body: chart({ symbol: 'AAPL', currency: 'USD', regularMarketPrice: 347.475, longName: 'Apple Inc.' }) })
    expect(await quoteSymbol('AAPL', impl)).toEqual({ symbol: 'AAPL', currency: 'USD', price: '347.475', name: 'Apple Inc.' })
    expect(calls[0].url.pathname).toBe('/v8/finance/chart/AAPL')
    expect(calls[0].url.searchParams.get('range')).toBe('5d')
  })

  it('formats the price as a plain decimal without exponent or float noise', async () => {
    const price = async (value: number) => (await quoteSymbol('X', fakeFetch({ body: chart({ currency: 'EUR', regularMarketPrice: value }) }).impl))?.price
    expect(await price(100)).toBe('100')
    expect(await price(10.5)).toBe('10.5')
    expect(await price(0.1 + 0.2)).toBe('0.3')
    expect(await price(1e-9)).toBeNull()
  })

  it.each([0, -1, Number.NaN, '12'])('gives no price for %j', async (value) => {
    const quote = await quoteSymbol('X', fakeFetch({ body: chart({ currency: 'EUR', regularMarketPrice: value }) }).impl)
    expect(quote).toMatchObject({ currency: 'EUR', price: null })
  })

  it('has no name when Yahoo gives none', async () => {
    expect(await quoteSymbol('X', fakeFetch({ body: chart({ currency: 'EUR', regularMarketPrice: 5 }) }).impl))
      .toEqual({ symbol: 'X', currency: 'EUR', price: '5', name: null })
  })

  it('returns null for a symbol Yahoo does not know', async () => {
    const unknown = { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }
    expect(await quoteSymbol('NOPE', fakeFetch({ status: 404, body: unknown }).impl)).toBeNull()
    expect(await quoteSymbol('NOPE', fakeFetch({ status: 200, body: unknown }).impl)).toBeNull()
  })

  it('url-encodes symbols such as BRK-B and ^-prefixed ones', async () => {
    const { impl, calls } = fakeFetch({ body: chart({ currency: 'USD', regularMarketPrice: 1 }) })
    await quoteSymbol('BRK-B', impl)
    expect(calls[0].url.pathname).toBe('/v8/finance/chart/BRK-B')
  })

  it.each(['', ' ', 'A B', 'A/B', '../etc', 'A?x=1', 'A'.repeat(21), '-A', 'A\nB'])('rejects the invalid symbol %j without calling Yahoo', async (symbol) => {
    const { impl, calls } = fakeFetch({ body: {} })
    await expect(quoteSymbol(symbol, impl)).rejects.toThrow(/Invalid symbol/)
    expect(calls).toHaveLength(0)
  })

  it('reports other failures and unreadable answers', async () => {
    await expect(quoteSymbol('X', fakeFetch({ status: 500, body: {} }).impl)).rejects.toThrow(/Yahoo quote failed \(500\)/)
    await expect(quoteSymbol('X', fakeFetch({ text: 'nope' }).impl)).rejects.toThrow(/Yahoo quote/)
    await expect(quoteSymbol('X', fakeFetch({ body: { chart: { result: [{}] } } }).impl)).rejects.toThrow(/Yahoo quote/)
  })
})
