const base = 'https://query1.finance.yahoo.com'
const userAgent = 'Mozilla/5.0 (compatible; portfolio-tracker)'
const timeoutMs = 8000
// What a person can buy and the worker can price; indices, futures and currencies are not holdings.
const buyable = ['EQUITY', 'ETF', 'MUTUALFUND']
const symbolPattern = /^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/

export type SymbolMatch = { symbol: string; name: string; exchange: string; type: string }
export type SymbolQuote = { symbol: string; currency: string; price: string | null; name: string | null }

type Fetch = typeof fetch

async function getJson(fetchImpl: Fetch, url: URL, what: string, okStatuses: number[] = []): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) })
  const text = await response.text()
  if (!response.ok && !okStatuses.includes(response.status)) throw new Error(`Yahoo ${what} failed (${response.status})`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Yahoo ${what} returned an unreadable answer`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

export async function searchSymbols(query: string, fetchImpl: Fetch = fetch, baseUrl: string = base): Promise<SymbolMatch[]> {
  const trimmed = query.trim()
  if (trimmed === '') return []
  if (trimmed.length > 64) throw new Error('Search text is too long')
  const url = new URL('/v1/finance/search', baseUrl)
  url.search = new URLSearchParams({ q: trimmed, quotesCount: '10', newsCount: '0', listsCount: '0' }).toString()
  const body = await getJson(fetchImpl, url, 'search')
  if (!isRecord(body) || !Array.isArray(body.quotes)) throw new Error('Yahoo search returned an unreadable answer')
  return body.quotes.flatMap((hit): SymbolMatch[] => {
    if (!isRecord(hit)) return []
    const symbol = text(hit.symbol)
    const type = text(hit.quoteType)
    if (symbol === undefined || type === undefined || !buyable.includes(type)) return []
    return [{ symbol, name: text(hit.longname) ?? text(hit.shortname) ?? symbol, exchange: text(hit.exchDisp) ?? text(hit.exchange) ?? '', type }]
  })
}

// A price is shown as a plain decimal. Twelve significant digits drop float noise (0.1 + 0.2), and a value that
// would need an exponent is treated as no price so the person types one instead.
function plainDecimal(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const rounded = String(Number(value.toPrecision(12)))
  return rounded.includes('e') ? null : rounded
}

export async function quoteSymbol(symbol: string, fetchImpl: Fetch = fetch, baseUrl: string = base): Promise<SymbolQuote | null> {
  if (!symbolPattern.test(symbol)) throw new Error(`Invalid symbol: ${symbol}`)
  const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, baseUrl)
  url.search = new URLSearchParams({ range: '5d', interval: '1d' }).toString()
  const body = await getJson(fetchImpl, url, 'quote', [404])
  const chart = isRecord(body) && isRecord(body.chart) ? body.chart : undefined
  if (chart === undefined) throw new Error('Yahoo quote returned an unreadable answer')
  if (chart.result === null && isRecord(chart.error) && chart.error.code === 'Not Found') return null
  const meta = Array.isArray(chart.result) && isRecord(chart.result[0]) && isRecord(chart.result[0].meta) ? chart.result[0].meta : undefined
  const currency = meta === undefined ? undefined : text(meta.currency)
  if (meta === undefined || currency === undefined) throw new Error('Yahoo quote returned an unreadable answer')
  return { symbol, currency, price: plainDecimal(meta.regularMarketPrice), name: text(meta.longName) ?? text(meta.shortName) ?? null }
}
