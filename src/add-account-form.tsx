'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AddAccountForm() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  return <form className="account-form" onSubmit={async (event) => {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch('/api/accounts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: data.get('name'), currency: data.get('currency'), comment: data.get('comment') }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) setError(body?.error ?? 'The account could not be added')
      else {
        setSaved(`Added ${data.get('name')}`)
        form.reset()
        router.refresh()
      }
    } catch {
      setError('The account could not be added. Check your connection and try again.')
    }
    setBusy(false)
  }}>
    <div className="field"><label htmlFor="account-name">Name</label><input id="account-name" name="name" required maxLength={80} autoComplete="off" /></div>
    <div className="field"><label htmlFor="account-currency">Currency</label><select id="account-currency" name="currency" defaultValue="EUR"><option value="EUR">EUR</option><option value="USD">USD</option></select></div>
    <div className="field wide"><label htmlFor="account-comment">Comment <small>(optional)</small></label><input id="account-comment" name="comment" maxLength={200} autoComplete="off" /></div>
    <button type="submit" disabled={busy}>Add account</button>
    {error && <p role="alert" className="error">{error}</p>}
    {saved && <p role="status" className="saved">{saved}</p>}
  </form>
}
