import type { Sql } from 'postgres'

// Historical correction, not a dated transfer: preserve every trade field except its account.
export async function consolidateAccounts(sql: Sql, sourceId: string, targetId: string): Promise<{ moved: number }> {
  if (sourceId === targetId) throw new Error('Accounts must differ')
  return sql.begin(async (tx) => {
    await tx`LOCK TABLE accounts, transactions, account_balances IN SHARE ROW EXCLUSIVE MODE`
    const accounts = await tx`SELECT id, currency, is_excluded FROM accounts WHERE id IN (${sourceId}, ${targetId}) FOR UPDATE`
    const source = accounts.find((account) => account.id === sourceId)
    const target = accounts.find((account) => account.id === targetId)
    if (!target) throw new Error('Target account not found')
    if (source && (source.currency !== target.currency || source.is_excluded !== target.is_excluded)) throw new Error('Account settings differ')
    const moved = await tx`UPDATE transactions SET account_id = ${targetId} WHERE account_id = ${sourceId} RETURNING id`
    await tx`DELETE FROM account_balances`
    await tx`UPDATE accounts SET balance = 0 WHERE balance <> 0`
    await tx`DELETE FROM accounts WHERE id = ${sourceId}`
    return { moved: moved.length }
  })
}
