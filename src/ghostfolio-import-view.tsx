'use client'

import { useRef, useState } from 'react'
import type { Counts } from './ledger-store'

export function importSummary({ created, skipped }: { created: Counts; skipped: Counts }) {
  const list = (counts: Counts) => `${counts.accounts} accounts, ${counts.balances} balances, ${counts.tags} tags, ${counts.activities} activities`
  return `Created ${list(created)}. Skipped ${list(skipped)}. Rejected 0 records.`
}

export function GhostfolioImportView() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const run = async () => {
    if (busy) return
    setBusy(true); setError(''); setSaved('')
    try {
      const file = fileInput.current?.files?.[0]
      if (!file) throw new Error('Choose a Ghostfolio export file')
      if (file.size > 2_097_152) throw new Error('Export must be no larger than 2 MiB')
      const response = await fetch('/api/ghostfolio/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ json: await file.text() }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? 'Import is unavailable; please try again')
      setSaved(importSummary(body))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return <main>
    <header><a href="/" className="brand"><span>Localfolio</span></a><div className="actions"><a className="back" href="/">Back to portfolio</a></div></header>
    <section className="card import">
      <h1>Import Ghostfolio export</h1>
      <p className="muted">Upload the JSON from Ghostfolio&apos;s activities export to bring over its accounts, balances, buys, sells and tags.</p>
      <ul className="rules">
        <li>Accounts are matched by their Ghostfolio ID, so records that already exist are skipped and uploading the same file again adds nothing.</li>
        <li>The whole file is checked first. If any part is invalid, nothing is saved.</li>
        <li>Maximum 2 MiB.</li>
      </ul>
      <form className="import-form" onSubmit={(event) => { event.preventDefault(); void run() }}>
        <div className="field">
          <label htmlFor="ghostfolio-file">Ghostfolio export (JSON)</label>
          <input ref={fileInput} id="ghostfolio-file" type="file" accept=".json,application/json" disabled={busy} onChange={() => { setError(''); setSaved('') }} />
        </div>
        <div><button type="submit" disabled={busy}>{busy ? 'Working…' : 'Import export'}</button></div>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {saved && <p role="status" className="saved">{saved}</p>}
    </section>
  </main>
}
