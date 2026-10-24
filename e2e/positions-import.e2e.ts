import { expect, test } from '@playwright/test'
import { e2e } from './env'

test('CSV upload previews before importing, skips repeat rows and displays imported holding', async ({ page, browserName }) => {
  await page.goto('/import')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.getByRole('link', { name: 'Import positions', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Import positions' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download CSV template' })).toHaveAttribute('download', 'positions-template.csv')
  const file = { name: 'positions.csv', mimeType: 'text/csv', buffer: Buffer.from(`account,symbol,quantity,average_price,currency,date\nCSV UI broker ${browserName},UIIMPORT,3.125,10.50,EUR,2026-01-02\n`) }
  await page.getByLabel('Positions CSV').setInputFiles(file)
  await page.getByRole('button', { name: 'Preview import' }).click()
  await expect(page.getByRole('table')).toContainText('UIIMPORT')
  await expect(page.getByText(/earlier performance/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByRole('status')).toContainText('Imported 1 positions; skipped 0 identical buys')
  await page.getByRole('button', { name: 'Preview import' }).click()
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByRole('status')).toContainText('Imported 0 positions; skipped 1 identical buys')
  await page.getByLabel('Positions CSV').setInputFiles({ ...file, buffer: Buffer.from('account,symbol,quantity,average_price,currency,date\nBad,AAPL,-1,10,EUR,2026-01-02\n') })
  await expect(page.getByRole('button', { name: 'Confirm import' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview import' }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('Row 2')
  await page.getByRole('link', { name: 'Back to portfolio' }).click()
  await expect(page.getByRole('link', { name: /UIIMPORT/ }).first()).toBeVisible()
})
