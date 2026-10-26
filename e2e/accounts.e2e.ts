import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { addTransaction, createAccount } from '../src/ledger-entry'
import { e2e, testDatabaseUrl } from './env'

test('accounts can be added from the app and deleted only after typing the name', async ({ page }, testInfo) => {
  const addedName = `Added in browser ${testInfo.project.name}`
  const sql = postgres(testDatabaseUrl(true))
  const doomed = await createAccount(sql, { name: 'Doomed account', currency: 'EUR' })
  await addTransaction(sql, { accountId: doomed.id, symbol: 'DOOMED_SYM', type: 'BUY', currency: 'EUR', date: '2026-01-01', quantity: '1', unitPrice: '10' })
  await sql.end()

  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.getByRole('link', { name: 'Manage accounts' }).click()
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
  await expect(page.getByText('Doomed account')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Doomed account' }).getByText('1 position · 1 transaction')).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill(addedName)
  await page.getByLabel('Currency').selectOption('USD')
  await page.getByLabel('Comment').fill('made by the e2e test')
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByText(`Added ${addedName}`, { exact: true })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: addedName }).getByText('made by the e2e test')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: addedName }).getByText('No activity yet')).toBeVisible()

  await page.getByLabel('Name', { exact: true }).fill(addedName)
  await page.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete account Doomed account' }).click()
  await expect(page.getByText(/and its 1 transaction/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Permanently delete' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Type Doomed account to confirm')).toHaveCount(0)
  await page.getByRole('button', { name: 'Delete account Doomed account' }).click()
  await page.getByLabel('Type Doomed account to confirm').fill('doomed account')
  await expect(page.getByRole('button', { name: 'Permanently delete' })).toBeDisabled()
  await page.getByLabel('Type Doomed account to confirm').fill('Doomed account')
  await page.getByRole('button', { name: 'Permanently delete' }).click()
  await expect(page.getByText('Doomed account')).toHaveCount(0)
  await expect(page.getByText(addedName, { exact: true })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: /Synthetic US Stock/ }).first()).toBeVisible()
})
