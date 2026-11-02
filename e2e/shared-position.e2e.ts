import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { addTransaction, createAccount } from '../src/ledger-entry'
import { e2e, testDatabaseUrl } from './env'

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

test('a symbol held in two accounts is one tile, one row and one position page', async ({ page }) => {
  const sql = postgres(testDatabaseUrl(true))
  const accounts = [await createAccount(sql, { name: 'Shared one', currency: 'EUR' }), await createAccount(sql, { name: 'Shared two', currency: 'EUR' })]
  try {
    await addTransaction(sql, { accountId: accounts[0].id, symbol: 'SHARED', type: 'BUY', currency: 'EUR', date: day(-30), quantity: '2', unitPrice: '10' })
    await addTransaction(sql, { accountId: accounts[1].id, symbol: 'SHARED', type: 'BUY', currency: 'EUR', date: day(-3), quantity: '3', unitPrice: '12' })
    for (const [offset, close] of [[-30, 10], [-3, 12], [-1, 13], [0, 14]] as const) {
      await sql`INSERT INTO security_prices VALUES ('SHARED', ${day(offset)}, ${close}, 'EUR', 'e2e', now())`
    }
    await page.goto('/login')
    await page.getByLabel('Password').fill(e2e.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()

    const tile = page.locator('a.heatmap-tile', { hasText: 'SHARED' })
    const row = page.locator('.movement-details li', { hasText: 'SHARED' })
    await expect(tile).toHaveCount(1)
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Shared one, Shared two')

    await tile.click()
    await expect(page).toHaveURL(/\/\?symbol=SHARED&/)
    expect(page.url()).not.toContain('account=')
    await expect(page.getByRole('heading', { name: 'SHARED' })).toBeVisible()
    await expect(page.locator('dd', { hasText: /^5$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove from Shared one' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove from Shared two' })).toBeVisible()

    // A link from before positions were combined names an account; it opens the same position.
    await page.goto(`/?account=${accounts[0].id}&symbol=SHARED`)
    await expect(page.getByRole('heading', { name: 'SHARED' })).toBeVisible()
    await expect(page.locator('dd', { hasText: /^5$/ })).toBeVisible()
  } finally {
    const ids = accounts.map((account) => account.id)
    await sql`DELETE FROM security_prices WHERE symbol = 'SHARED'`
    await sql`DELETE FROM transactions WHERE account_id IN ${sql(ids)}`
    await sql`DELETE FROM accounts WHERE id IN ${sql(ids)}`
    await sql.end()
  }
})
