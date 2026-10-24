import { add, decimalToFraction, formatFraction, multiply, subtract } from './fraction'

export type CashActivity = {
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE'
  quantity: string
  unitPrice: string
  fee: string
  currency: 'EUR' | 'USD'
  eurPerUsd?: string
}

// Placeholder until the owner supplies a cash balance: shown as a position worth EUR 0.
const cashEur = '0'

type CashItem = {
  accountId: string; accountName: string; symbol: string; name: string; kind: 'cash'
  value: string; changePercent: string; observedOn: null; previousOn: null
}

// Appends the cash position after the others; an empty portfolio stays empty so its empty state still shows.
export function withCash<T extends object>(items: T[]): (T | CashItem)[] {
  if (items.length === 0) return items
  return [...items, { accountId: 'cash', accountName: 'Cash', symbol: 'CASH', name: 'Cash', kind: 'cash',
    value: cashEur, changePercent: '0', observedOn: null, previousOn: null }]
}

// Cash movements are stored as quantity 1 at the amount. Activities are for one account; results are in EUR.
export function calculateCash(activities: CashActivity[]) {
  let cash = decimalToFraction('0')
  let dividends = decimalToFraction('0')
  let fees = decimalToFraction('0')

  for (const activity of activities) {
    let rate = decimalToFraction('1')
    if (activity.currency === 'USD') {
      if (activity.eurPerUsd === undefined) throw new Error('Historical USD/EUR rate is required')
      rate = decimalToFraction(activity.eurPerUsd)
    }
    const amount = multiply(multiply(decimalToFraction(activity.quantity), decimalToFraction(activity.unitPrice)), rate)
    const fee = multiply(decimalToFraction(activity.fee), rate)

    if (activity.type === 'DEPOSIT') cash = add(cash, amount)
    else if (activity.type === 'WITHDRAWAL') cash = subtract(cash, amount)
    else if (activity.type === 'DIVIDEND') {
      cash = add(cash, amount)
      dividends = add(dividends, amount)
    } else if (activity.type === 'FEE') {
      cash = subtract(cash, amount)
      fees = add(fees, amount)
    } else {
      cash = activity.type === 'BUY' ? subtract(cash, add(amount, fee)) : add(cash, subtract(amount, fee))
      fees = add(fees, fee)
    }
  }

  return { cash: formatFraction(cash), dividends: formatFraction(dividends), fees: formatFraction(fees) }
}
