import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { addTransaction, createAccount } from '../src/ledger-entry'
import { e2e, testDatabaseUrl } from './env'

test('remove position requires confirmation, supports cancel, and leaves other holdings', async ({ page }) => {
  const sql = postgres(testDatabaseUrl(true))
  const account = await createAccount(sql, { name: 'Removal test', currency: 'EUR' })
  await addTransaction(sql, { accountId: account.id, symbol: 'REMOVE_ME', type: 'BUY', currency: 'EUR', date: '2026-01-01', quantity: '1', unitPrice: '10' })
  await sql.end()
  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.goto(`/?account=${account.id}&symbol=REMOVE_ME`)
  await expect(page.getByRole('heading', { name: 'REMOVE_ME' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove position', exact: true }).click()
  await expect(page.getByText(/permanently removes all buys, sells and dividends/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Permanently remove' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Type REMOVE_ME to confirm')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove position', exact: true }).click()
  await page.getByLabel('Type REMOVE_ME to confirm').fill('WRONG')
  await expect(page.getByRole('button', { name: 'Permanently remove' })).toBeDisabled()
  await page.getByLabel('Type REMOVE_ME to confirm').fill('REMOVE_ME')
  await page.getByRole('button', { name: 'Permanently remove' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.goto(`/?account=${account.id}&symbol=REMOVE_ME`)
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('link', { name: /Synthetic US Stock/ }).first()).toBeVisible()
})
