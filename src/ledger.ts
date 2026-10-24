import { add, decimalToFraction, divide, formatFraction, multiply, subtract } from './fraction'

export type Transaction = {
  type: 'BUY' | 'SELL' | 'DIVIDEND'
  quantity: string
  unitPrice: string
  fee: string
  currency: string
  eurPerUsd?: string
}

// Transactions must be supplied in chronological order for one account and instrument.
export function calculatePosition(transactions: Transaction[], reportingCurrency?: 'EUR', quote?: { price: string; currency: string; eurPerUsd?: string }) {
  if (transactions.length === 0) {
    throw new Error('At least one transaction is required')
  }

  const currency = reportingCurrency ?? transactions[0].currency
  let quantity = decimalToFraction('0')
  let invested = decimalToFraction('0')
  let realizedGain = decimalToFraction('0')

  for (const transaction of transactions) {
    let rate = decimalToFraction('1')
    if (reportingCurrency === 'EUR') {
      if (transaction.currency === 'USD') {
        if (transaction.eurPerUsd === undefined) {
          throw new Error('Historical USD/EUR rate is required')
        }
        rate = decimalToFraction(transaction.eurPerUsd)
        if (rate.numerator === 0n) {
          throw new Error('Historical USD/EUR rate must be positive')
        }
      } else if (transaction.currency !== 'EUR') {
        throw new Error('Unsupported transaction currency')
      }
    } else if (transaction.currency !== currency) {
      throw new Error('Transactions must have the same currency')
    }

    const transactionQuantity = decimalToFraction(transaction.quantity)
    const unitPrice = multiply(decimalToFraction(transaction.unitPrice), rate)
    const fee = multiply(decimalToFraction(transaction.fee), rate)

    if (transaction.type === 'DIVIDEND') {
      // Stored as quantity 1 at the dividend amount; income leaves quantity and cost basis alone.
      realizedGain = add(realizedGain, multiply(transactionQuantity, unitPrice))
    } else if (transaction.type === 'BUY') {
      quantity = add(quantity, transactionQuantity)
      invested = add(invested, add(multiply(transactionQuantity, unitPrice), fee))
    } else {
      if (transactionQuantity.numerator * quantity.denominator > quantity.numerator * transactionQuantity.denominator) {
        throw new Error('Cannot sell more than held')
      }
      const removedCost = multiply(divide(invested, quantity), transactionQuantity)
      const proceeds = subtract(multiply(transactionQuantity, unitPrice), fee)
      realizedGain = add(realizedGain, subtract(proceeds, removedCost))
      invested = subtract(invested, removedCost)
      quantity = subtract(quantity, transactionQuantity)
    }
  }

  let valuation: { marketValue: string; unrealizedGain: string } | undefined
  if (quote !== undefined) {
    if (reportingCurrency !== 'EUR') throw new Error('Valuation requires EUR reporting')
    if (quote.currency !== 'EUR' && quote.currency !== 'USD') throw new Error('Unsupported quote currency')
    if (quote.currency === 'USD' && quote.eurPerUsd === undefined) throw new Error('Quote USD/EUR rate is required')
    const price = decimalToFraction(quote.price)
    const rate = decimalToFraction(quote.currency === 'USD' ? quote.eurPerUsd! : '1')
    if (price.numerator === 0n || rate.numerator === 0n) throw new Error('Quote price and rate must be positive')
    const marketValue = multiply(multiply(quantity, price), rate)
    valuation = { marketValue: formatFraction(marketValue), unrealizedGain: formatFraction(subtract(marketValue, invested)) }
  }

  return {
    ...valuation,
    quantity: formatFraction(quantity),
    averageCost: quantity.numerator === 0n && transactions.some((transaction) => transaction.type === 'SELL')
      ? '0' : formatFraction(divide(invested, quantity)),
    invested: formatFraction(invested),
    realizedGain: formatFraction(realizedGain),
    currency,
  }
}
