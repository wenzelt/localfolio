export const positionsTemplate = 'account,symbol,quantity,average_price,currency,date\nBroker,VWCE.DE,12.5,100.25,EUR,2026-01-02\n'
export type PositionRow = { line: number; account: string; symbol: string; quantity: string; averagePrice: string; currency: string; date: string }

export function parsePositionsCsv(text: string, today: string): PositionRow[] {
  if (new TextEncoder().encode(text).length > 1_048_576) throw new Error('CSV must be no larger than 1 MiB')
  const records: { line: number; values: string[] }[] = []
  let values: string[] = [], field = '', quoted = false, closed = false, line = 1, start = 1
  const finishField = () => { values.push(field.trim()); field = ''; closed = false }
  const finishRow = () => { finishField(); if (values.some(Boolean)) records.push({ line: start, values }); values = []; start = line + 1 }
  text = text.replace(/^﻿/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else { field += char; if (char === '\n') line++ }
    } else if (char === ',') finishField()
    else if (char === '\n') { finishRow(); line++ }
    else if (char === '"' && field === '' && !closed) quoted = true
    else if (char === '"' || (closed && char.trim() !== '')) throw new Error(`Row ${start}: invalid quote`)
    else field += char
  }
  if (quoted) throw new Error(`Row ${start}: unclosed quote`)
  if (field !== '' || values.length > 0 || closed) finishRow()
  if (records[0]?.values.length !== 6 || records[0]?.values.join(',') !== 'account,symbol,quantity,average_price,currency,date') throw new Error('Expected header: account,symbol,quantity,average_price,currency,date')
  if (records.length === 1) throw new Error('CSV must contain at least one position')
  if (records.length > 1001) throw new Error('CSV may contain at most 1000 positions')
  return records.slice(1).map(({ line, values }) => {
    const fail = (message: string): never => { throw new Error(`Row ${line}: ${message}`) }
    if (values.length !== 6) fail('expected 6 columns')
    const [account, rawSymbol, quantity, averagePrice, currency, date] = values
    const symbol = rawSymbol.toUpperCase()
    if (!account || account.length > 200) fail('account is required (maximum 200 characters)')
    if (!/^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$/.test(symbol)) fail('invalid Yahoo symbol')
    if (!/^\d+(\.\d+)?$/.test(quantity) || !/[1-9]/.test(quantity)) fail('quantity must be a positive plain decimal')
    if (!/^\d+(\.\d+)?$/.test(averagePrice)) fail('price must be a nonnegative plain decimal')
    if (!['EUR', 'USD'].includes(currency)) fail('currency must be EUR or USD')
    const parsed = new Date(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('invalid date; use YYYY-MM-DD')
    if (date > today) fail('date cannot be in the future')
    return { line, account, symbol, quantity, averagePrice, currency, date }
  })
}
