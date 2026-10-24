// A local stand-in for the two Yahoo endpoints the buy form uses. The app's server calls Yahoo, so
// the browser cannot intercept it; the test app is pointed here through YAHOO_BASE_URL instead.
import { createServer } from 'node:http'

const listings = [
  { symbol: 'EUETF', longname: 'Synthetic EU ETF', exchDisp: 'Xetra', quoteType: 'ETF', currency: 'EUR', price: 101.5 },
  { symbol: 'NEWCO', longname: 'Newco Holdings', exchDisp: 'NASDAQ', quoteType: 'EQUITY', currency: 'USD', price: 12.34 },
  { symbol: 'LONDN', longname: 'London Listed Plc', exchDisp: 'LSE', quoteType: 'EQUITY', currency: 'GBp', price: 450 },
  { symbol: 'INDEX', longname: 'Not Buyable Index', exchDisp: 'Index', quoteType: 'INDEX', currency: 'EUR', price: 1 },
]

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
  if (url.pathname === '/v1/finance/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const quotes = listings.filter((item) => item.symbol.toLowerCase().includes(q) || item.longname.toLowerCase().includes(q))
      .map(({ symbol, longname, exchDisp, quoteType }) => ({ symbol, longname, exchDisp, quoteType }))
    return send(200, { quotes })
  }
  const chart = url.pathname.match(/^\/v8\/finance\/chart\/(.+)$/)
  if (chart) {
    const item = listings.find((candidate) => candidate.symbol === decodeURIComponent(chart[1]))
    if (!item) return send(404, { chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } })
    return send(200, { chart: { result: [{ meta: { symbol: item.symbol, currency: item.currency, regularMarketPrice: item.price, longName: item.longname } }], error: null } })
  }
  send(404, {})
}).listen(Number(process.env.PORT ?? 3101), '127.0.0.1')
