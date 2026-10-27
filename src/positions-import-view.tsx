'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type PositionRow, positionsTemplate } from './positions-csv'

export function PositionsImportView() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<PositionRow[]>([])
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [newFile, setNewFile] = useState(0)
  const generation = useRef(0)

  const run = async (action: 'preview' | 'import') => {
    if (busy) return
    const current = generation.current
    setBusy(true); setError(''); setSaved('')
    try {
      let text = csv
      if (action === 'preview') {
        setRows([])
        const file = fileInput.current?.files?.[0]
        if (!file) throw new Error('Choose a CSV file')
        if (file.size > 1_048_576) throw new Error('CSV must be no larger than 1 MiB')
        text = await file.text()
      }
      if (current !== generation.current) return
      const response = await fetch('/api/positions/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: text, action }) })
      const body = await response.json().catch(() => null)
      if (current !== generation.current) return
      if (!response.ok) throw new Error(body?.error ?? 'Import is unavailable; please try again')
      if (action === 'preview') { setCsv(text); setRows(body.rows) }
      else {
        setRows([])
        setSaved(`Imported ${body.created} positions; skipped ${body.skipped} identical buys. New symbols are valued after the next market data refresh.`)
        router.refresh()
      }
    } catch (problem) {
      if (current === generation.current) setError(problem instanceof Error ? problem.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return <main>
    <header><a href="/" className="brand"><span>Localfolio</span></a><div className="actions"><a className="back" href="/">Back to portfolio</a></div></header>
    <section className="card import">
      <h1>Import positions</h1>
      <p>Upload current holdings as opening buys. This adds to existing positions; it does not replace them or recreate earlier performance. No cash is moved.</p>
      <ul className="rules">
        <li>Use Yahoo tickers and plain decimal numbers with a dot. Only EUR and USD are supported. Dates use YYYY-MM-DD. Maximum 1000 rows and 1 MiB.</li>
        <li>Accounts match by exact name; missing accounts are created. A new account must use one currency.</li>
        <li>Identical buys are skipped, including repeat uploads.</li>
        <li>Symbols are not checked against Yahoo during import; verify tickers before confirming.</li>
      </ul>
      <p><a className="quiet" href={`data:text/csv;charset=utf-8,${encodeURIComponent(positionsTemplate)}`} download="positions-template.csv">Download CSV template</a></p>
      <form className="import-form" key={newFile} onSubmit={(event) => { event.preventDefault(); void run('preview') }}>
        <div className="field">
          <label htmlFor="positions-file">Positions CSV</label>
          <input ref={fileInput} id="positions-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={() => { generation.current++; setRows([]); setCsv(''); setError(''); setSaved('') }} />
        </div>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Working…' : 'Preview import'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="saved" role="status">{saved}</p>}
      {rows.length > 0 && <ImportPreview rows={rows} busy={busy} onConfirm={() => void run('import')} onCancel={() => { generation.current++; setRows([]); setCsv(''); setNewFile((value) => value + 1) }} />}
    </section>
  </main>
}

const columns: { label: string; key: keyof PositionRow; numeric?: boolean }[] = [
  { label: 'Row', key: 'line', numeric: true }, { label: 'Account', key: 'account' }, { label: 'Symbol', key: 'symbol' },
  { label: 'Quantity', key: 'quantity', numeric: true }, { label: 'Average price', key: 'averagePrice', numeric: true }, { label: 'Currency', key: 'currency' }, { label: 'Date', key: 'date' },
]

export function ImportPreview({ rows, busy, onConfirm, onCancel }: { rows: PositionRow[]; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <section className="import-preview" aria-label="Import preview">
    <h2>Preview: {rows.length} positions</h2>
    <div className="table-scroll"><table className="import-table">
      <thead><tr>{columns.map(({ label, numeric }) => <th key={label} className={numeric ? 'num' : undefined}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.line}>{columns.map(({ label, key, numeric }) => <td key={label} className={numeric ? 'num' : undefined}>{row[key]}</td>)}</tr>)}</tbody>
    </table></div>
    <p>Confirm to add these opening buys. Existing holdings remain; identical buys are skipped. Invalid imports save nothing.</p>
    <div className="import-actions">
      <button type="button" className="primary" disabled={busy} onClick={onConfirm}>Confirm import</button>
      <button type="button" className="quiet" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </section>
}
