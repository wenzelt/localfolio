'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DeleteAccountControl({ accountId, name, transactions }: { accountId: string; name: string; transactions: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = `Type ${name} to confirm`
  if (!open) return <button type="button" className="quiet" aria-label={`Delete account ${name}`} onClick={() => setOpen(true)}>Delete account</button>
  return <section aria-label={`Delete account ${name}`} className="delete-account">
    <h3>Delete {name}?</h3>
    <p>This permanently deletes the account{transactions > 0 ? ` and its ${transactions} ${transactions === 1 ? 'transaction' : 'transactions'}` : ''}. Historical performance will change. It cannot be undone here. Make a backup first.</p>
    <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy || confirmation !== name) return
      setBusy(true)
      setError('')
      try {
        const response = await fetch('/api/accounts', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, confirm: confirmation }) })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          setError(body?.error ?? 'The account could not be deleted')
          setBusy(false)
          return
        }
        router.refresh()
      } catch {
        setError('The account could not be deleted. Check your connection and try again.')
        setBusy(false)
      }
    }}>
      <label>{label} <input aria-label={label} autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <button type="submit" disabled={busy || confirmation !== name}>{busy ? 'Deleting…' : 'Permanently delete'}</button>
      <button type="button" className="quiet" disabled={busy} onClick={() => { setOpen(false); setConfirmation(''); setError('') }}>Cancel</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </section>
}
