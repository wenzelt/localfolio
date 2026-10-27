'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { type BuyFields, buyRequest, debounce, latestOnly, submitOutcome } from './buy-form-logic'

type Account = { id: string; name: string; currency: string; comment: string | null }
type Match = { symbol: string; name: string; exchange: string; type: string }
type Quote = { symbol: string; currency: string; price: string | null; name: string | null; supported: boolean }

const minimumSearch = 2
const pause = 250

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { signal })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const messageOf = (body: unknown, fallback: string) =>
  typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : fallback

export function BuyView({ accounts, today, account, symbol }: { accounts: Account[]; today: string; account?: string; symbol?: string }) {
  return <main>
    <header><a href="/" className="brand"><span>Localfolio</span></a><div className="actions"><a className="back" href="/">Back to portfolio</a></div></header>
    <section className="card buy">
      <h1>Add a buy</h1>
      {accounts.length === 0
        ? <p>No account yet. Create one first with <code>npm run ledger:add -- account --name "Broker" --currency EUR</code>, then come back here.</p>
        : <BuyForm accounts={accounts} today={today} account={account} symbol={symbol} />}
    </section>
  </main>
}

function BuyForm({ accounts, today, account, symbol }: { accounts: Account[]; today: string; account?: string; symbol?: string }) {
  const router = useRouter()
  const chosen = accounts.find((candidate) => candidate.id === account) ?? (accounts.length === 1 ? accounts[0] : undefined)
  const [fields, setFields] = useState<BuyFields>({ accountId: chosen?.id ?? '', symbol: symbol ?? '', date: today, quantity: '', unitPrice: '', currency: chosen?.currency ?? 'EUR', fee: '', comment: '' })
  const [query, setQuery] = useState(symbol ?? '')
  const [matches, setMatches] = useState<Match[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [searchNote, setSearchNote] = useState('')
  const [picked, setPicked] = useState<Quote | null>(null)
  const [problem, setProblem] = useState('')
  const [duplicate, setDuplicate] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)
  const newestSearch = useRef(latestOnly()).current
  const newestQuote = useRef(latestOnly()).current

  const search = useMemo(() => debounce(async (text: string) => {
    const current = newestSearch()
    const trimmed = text.trim()
    if (trimmed.length < minimumSearch) { setMatches([]); setOpen(false); setSearchNote(''); return }
    try {
      const { status, body } = await getJson(`/api/symbols?q=${encodeURIComponent(trimmed)}`)
      if (!current()) return
      const found = status === 200 && typeof body === 'object' && body !== null ? ((body as { matches?: Match[] }).matches ?? []) : null
      if (found === null) { setMatches([]); setOpen(false); setSearchNote(messageOf(body, 'Search is not available right now')); return }
      setMatches(found)
      setActive(-1)
      setOpen(found.length > 0)
      setSearchNote(found.length === 0 ? `Nothing found for “${trimmed}”` : '')
    } catch {
      if (current()) { setMatches([]); setOpen(false); setSearchNote('Search is not available right now') }
    }
  }, pause), [newestSearch])
  useEffect(() => () => search.cancel(), [search])

  const change = (patch: Partial<BuyFields>) => { setFields((now) => ({ ...now, ...patch })); setSaved(''); setDuplicate(''); setProblem('') }

  const type = (text: string) => {
    setQuery(text)
    setPicked(null)
    change({ symbol: '' })
    search(text)
  }

  const choose = async (match: Match) => {
    const current = newestQuote()
    search.cancel()
    newestSearch()
    setQuery(match.symbol)
    setOpen(false)
    setMatches([])
    change({ symbol: match.symbol })
    try {
      const { status, body } = await getJson(`/api/symbols/quote?symbol=${encodeURIComponent(match.symbol)}`)
      if (!current()) return
      if (status !== 200) { setProblem(messageOf(body, `No price could be fetched for ${match.symbol}`)); return }
      const quote = body as Quote
      setPicked(quote)
      if (!quote.supported) { setProblem(`${quote.symbol} is quoted in ${quote.currency}; only EUR and USD can be recorded`); return }
      setFields((now) => ({ ...now, symbol: quote.symbol, currency: quote.currency, unitPrice: now.unitPrice === '' ? (quote.price ?? '') : now.unitPrice }))
    } catch {
      if (current()) setProblem(`No price could be fetched for ${match.symbol}`)
    }
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && matches.length > 0) { event.preventDefault(); setOpen(true); setActive((now) => (now + 1) % matches.length) }
    else if (event.key === 'ArrowUp' && matches.length > 0) { event.preventDefault(); setOpen(true); setActive((now) => (now <= 0 ? matches.length - 1 : now - 1)) }
    else if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); void choose(matches[active]) }
    else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false) }
  }

  const submit = async (event: FormEvent, force = false) => {
    event.preventDefault()
    const request = buyRequest(fields, today, force)
    if (!request.ok) { setProblem(request.error); return }
    if (picked && !picked.supported) { setProblem(`${picked.symbol} is quoted in ${picked.currency}; only EUR and USD can be recorded`); return }
    setBusy(true)
    setProblem('')
    setDuplicate('')
    try {
      const response = await fetch('/api/buys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) })
      const outcome = submitOutcome(response.status, await response.json().catch(() => null))
      if (outcome.kind === 'duplicate') setDuplicate(outcome.message)
      else if (outcome.kind === 'error') setProblem(outcome.message)
      else {
        setSaved(`Saved ${request.body.quantity} × ${request.body.symbol}.${outcome.priced ? '' : ' It is valued after the next market data refresh.'}`)
        setFields((now) => ({ ...now, quantity: '', fee: '', comment: '' }))
        router.refresh()
      }
    } catch {
      setProblem('The buy could not be saved. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const listbox = 'buy-symbol-results'
  return <form className="buy-form" onSubmit={(event) => submit(event)} noValidate>
    <div className="field">
      <label htmlFor="buy-account">Account</label>
      <select id="buy-account" value={fields.accountId} onChange={(event) => change({ accountId: event.target.value })} required>
        <option value="">Choose an account</option>
        {accounts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.currency})</option>)}
      </select>
    </div>
    <div className="field symbol-field">
      <label htmlFor="buy-symbol">Symbol</label>
      <div className="combo"><input id="buy-symbol" type="text" role="combobox" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Search by name or ticker" value={query}
        aria-expanded={open} aria-controls={listbox} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `buy-match-${active}` : undefined}
        onChange={(event) => type(event.target.value)} onKeyDown={keys} onBlur={() => setOpen(false)} onFocus={() => setOpen(matches.length > 0)} />
      <div id={listbox} role="listbox" aria-label="Matching symbols" hidden={!open}>
        {matches.map((match, index) => <div key={match.symbol} id={`buy-match-${index}`} role="option" tabIndex={-1} aria-selected={index === active}
          onMouseDown={(event) => { event.preventDefault(); void choose(match) }}>
          <strong>{match.symbol}</strong><span>{match.name}</span><small>{match.exchange} · {match.type}</small>
        </div>)}
      </div></div>
      <p className="hint" aria-live="polite">{picked ? [picked.name, picked.price === null ? null : `last price ${picked.price} ${picked.currency}`].filter(Boolean).join(' · ') : searchNote}</p>
    </div>
    <div className="field"><label htmlFor="buy-date">Date</label><input id="buy-date" type="date" value={fields.date} max={today} onChange={(event) => change({ date: event.target.value })} required /></div>
    <div className="field"><label htmlFor="buy-quantity">Quantity</label><input id="buy-quantity" type="text" inputMode="decimal" autoComplete="off" value={fields.quantity} onChange={(event) => change({ quantity: event.target.value })} /></div>
    <div className="field"><label htmlFor="buy-price">Price per unit</label><input id="buy-price" type="text" inputMode="decimal" autoComplete="off" value={fields.unitPrice} onChange={(event) => change({ unitPrice: event.target.value })} /></div>
    <div className="field"><label htmlFor="buy-currency">Currency</label>
      <select id="buy-currency" value={fields.currency} onChange={(event) => change({ currency: event.target.value })}><option value="EUR">EUR</option><option value="USD">USD</option></select></div>
    <div className="field"><label htmlFor="buy-fee">Fee <small>(optional)</small></label><input id="buy-fee" type="text" inputMode="decimal" autoComplete="off" value={fields.fee} onChange={(event) => change({ fee: event.target.value })} /></div>
    <div className="field wide"><label htmlFor="buy-comment">Comment <small>(optional)</small></label><input id="buy-comment" type="text" maxLength={200} value={fields.comment} onChange={(event) => change({ comment: event.target.value })} /></div>
    <div className="messages wide">
      {problem && <p role="alert" className="error">{problem}</p>}
      {duplicate && <p role="alert" className="error">{duplicate} <button type="button" className="quiet" disabled={busy} onClick={(event) => submit(event, true)}>Save anyway</button></p>}
      {saved && <p role="status" className="saved">{saved}</p>}
    </div>
    <div className="wide"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save buy'}</button></div>
  </form>
}
