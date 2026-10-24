import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { e2e } from './env'

async function signIn(page: Page, path: string) {
  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.goto(path)
  // Interactions fired before React has hydrated are silently lost, so wait for it
  await page.waitForFunction(() => Object.keys(document.querySelector('main') as Element).some((key) => key.startsWith('__reactFiber')))
}

test.describe('adding a buy', () => {
  test('a visitor without a session is sent to the login page', async ({ page }) => {
    await page.goto('/buy')
    await expect(page).toHaveURL(/\/login/)
  })

  test('search as you type, pick a result, and the price and currency are filled in', async ({ page }) => {
    await signIn(page, '/buy')
    const symbol = page.getByRole('combobox', { name: 'Symbol' })
    await symbol.fill('new')
    const option = page.getByRole('option', { name: /NEWCO/ })
    await expect(option).toContainText('Newco Holdings')
    await expect(page.getByRole('option', { name: /INDEX/ })).toHaveCount(0)
    await symbol.press('ArrowDown')
    await symbol.press('Enter')
    await expect(symbol).toHaveValue('NEWCO')
    await expect(page.getByLabel('Price per unit')).toHaveValue('12.34')
    await expect(page.getByLabel('Currency')).toHaveValue('USD')
  })

  test('a currency that cannot be recorded is refused before saving', async ({ page }) => {
    await signIn(page, '/buy')
    await page.getByRole('combobox', { name: 'Symbol' }).fill('london')
    await page.getByRole('option', { name: /LONDN/ }).click()
    await expect(page.locator('main').getByRole('alert')).toContainText('only EUR and USD can be recorded')
  })

  test('saving a new position shows it on the dashboard; a repeat needs a deliberate Save anyway', async ({ page, browserName }) => {
    const quantity = { chromium: '3', firefox: '4', webkit: '5' }[browserName]
    await signIn(page, '/buy')
    await page.getByLabel('Account').selectOption({ label: 'Main broker (EUR)' })
    await page.getByRole('combobox', { name: 'Symbol' }).fill('newco')
    await page.getByRole('option', { name: /NEWCO/ }).click()
    await expect(page.getByLabel('Currency')).toHaveValue('USD')
    await page.getByLabel('Quantity').fill(quantity)
    await page.getByRole('button', { name: 'Save buy' }).click()
    await expect(page.getByRole('status')).toContainText(`Saved ${quantity} × NEWCO`)
    await expect(page.getByRole('status')).toContainText('valued after the next market data refresh')

    await page.getByLabel('Quantity').fill(quantity)
    await page.getByRole('button', { name: 'Save buy' }).click()
    await expect(page.locator('main').getByRole('alert')).toContainText('An identical buy is already saved')
    await page.getByRole('button', { name: 'Save anyway' }).click()
    await expect(page.getByRole('status')).toContainText(`Saved ${quantity} × NEWCO`)

    await page.getByRole('link', { name: 'Back to portfolio' }).click()
    await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  })

  test('Buy more on a position opens the form with account and symbol chosen', async ({ page }) => {
    await signIn(page, '/')
    await page.getByRole('link', { name: /Synthetic EU ETF/ }).first().click()
    await page.getByRole('link', { name: 'Buy more' }).click()
    await expect(page).toHaveURL(/\/buy\?account=.*&symbol=EUETF/)
    await expect(page.getByLabel('Account')).toHaveValue(/.+/)
    await expect(page.getByRole('combobox', { name: 'Symbol' })).toHaveValue('EUETF')
  })
})
