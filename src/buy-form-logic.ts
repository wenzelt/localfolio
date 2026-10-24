export type BuyFields = {
  accountId: string
  symbol: string
  date: string
  quantity: string
  unitPrice: string
  currency: string
  fee: string
  comment: string
}

export type BuyBody = {
  accountId: string
  symbol: string
  date: string
  quantity: string
  unitPrice: string
  currency: string
  fee?: string
  comment?: string
  force?: true
}

export type BuyRequest = { ok: true; body: BuyBody } | { ok: false; error: string }

// Decimals stay strings from the keyboard to the database; a comma is accepted because many keyboards type one.
const decimal = (text: string) => {
  const value = text.trim().replace(',', '.')
  return /^\d+(?:\.\d+)?$/.test(value) ? value : null
}

const positive = (value: string | null): value is string => value !== null && /[1-9]/.test(value)

export function buyRequest(fields: BuyFields, today: string, force = false): BuyRequest {
  const quantity = decimal(fields.quantity)
  const unitPrice = decimal(fields.unitPrice)
  const fee = decimal(fields.fee)
  const symbol = fields.symbol.trim().toUpperCase()
  const fail = (error: string): BuyRequest => ({ ok: false, error })
  if (fields.accountId === '') return fail('Choose an account')
  if (symbol === '') return fail('Search for a symbol and pick it from the list')
  if (fields.date === '') return fail('Enter the date of the purchase')
  if (fields.date > today) return fail('A buy cannot be dated in the future')
  if (!positive(quantity)) return fail('Enter a quantity greater than zero')
  if (unitPrice === null) return fail('Enter the price per unit')
  if (fields.fee.trim() !== '' && fee === null) return fail('Enter the fee as a number, or leave it empty')
  if (fields.currency !== 'EUR' && fields.currency !== 'USD') return fail('Only EUR and USD can be recorded')
  const comment = fields.comment.trim()
  return {
    ok: true,
    body: {
      accountId: fields.accountId, symbol, date: fields.date, quantity, unitPrice, currency: fields.currency,
      ...(fee === null ? {} : { fee }),
      ...(comment === '' ? {} : { comment }),
      ...(force ? { force: true as const } : {}),
    },
  }
}

export function debounce<Args extends unknown[]>(run: (...args: Args) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const call = (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => run(...args), wait)
  }
  call.cancel = () => clearTimeout(timer)
  return call
}

// Each call starts a new request and hands back a check that is true only while no newer request has started.
export function latestOnly() {
  let newest = 0
  return () => {
    const mine = ++newest
    return () => mine === newest
  }
}

export type SubmitOutcome =
  | { kind: 'saved'; priced: boolean }
  | { kind: 'duplicate'; message: string }
  | { kind: 'error'; message: string }

const generic = 'The buy could not be saved'

export function submitOutcome(status: number, body: unknown): SubmitOutcome {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (status === 201) return { kind: 'saved', priced: fields.priced === true }
  if (status === 409 && fields.duplicate === true) return { kind: 'duplicate', message: 'An identical buy is already saved.' }
  if (status === 401) return { kind: 'error', message: 'Your session has ended. Sign in again.' }
  return { kind: 'error', message: typeof fields.error === 'string' && fields.error !== '' ? fields.error : generic }
}
