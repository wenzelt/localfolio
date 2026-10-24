'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RemovePositionControl({ accountId, accountName, symbol }: { accountId: string; accountName: string; symbol: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = `Type ${symbol} to confirm`
  if (!open) return <button type="button" className="quiet" onClick={() => setOpen(true)}>Remove position</button>
  return <section aria-label="Remove position" className="card">
    <h2>Remove {symbol} from {accountName}?</h2>
    <p>This permanently removes all buys, sells and dividends for this symbol in this account. Historical performance will change. This is not a sale and cannot be undone here. Make a backup first.</p>
    <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy || confirmation !== symbol) return
      setBusy(true)
      setError('')
      try {
        const response = await fetch('/api/positions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, symbol, confirm: confirmation }) })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          setError(body?.error ?? 'The position could not be removed')
          setBusy(false)
          return
        }
        router.replace('/')
        router.refresh()
      } catch {
        setError('The position could not be removed. Check your connection and try again.')
        setBusy(false)
      }
    }}>
      <label>{label} <input aria-label={label} autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button type="submit" disabled={busy || confirmation !== symbol}>{busy ? 'Removing…' : 'Permanently remove'}</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => { setOpen(false); setConfirmation(''); setError('') }}>Cancel</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}
