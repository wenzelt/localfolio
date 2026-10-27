import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { e2e } from './env'

const sampleText = readFileSync('docs/examples/ghostfolio-export.sample.json', 'utf8')
const sampleAccountId = '00000000-0000-4000-8000-000000000001'

test('Ghostfolio export upload reports counts, skips a repeat and rejects a bad file', async ({ page, browserName }) => {
  // The browsers share one database, so each imports the sample under its own Ghostfolio account ID.
  const browserId = `00000000-0000-4000-8000-${Buffer.from(browserName).toString('hex').padEnd(12, '0').slice(0, 12)}`
  const sample = Buffer.from(sampleText.replaceAll(sampleAccountId, browserId))
  await page.goto('/import/ghostfolio')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  await page.goto('/import')
  await page.getByRole('link', { name: /Ghostfolio/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Import Ghostfolio export' })).toBeVisible()
  const upload = (buffer: Buffer) => page.getByLabel('Ghostfolio export (JSON)').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer })
  await upload(sample)
  await page.getByRole('button', { name: 'Import export' }).click()
  await expect(page.getByRole('status')).toContainText(/Created 1 accounts.*Skipped 0 accounts.*Rejected 0 records/)
  await upload(sample)
  await page.getByRole('button', { name: 'Import export' }).click()
  await expect(page.getByRole('status')).toContainText(/Created 0 accounts.*Skipped 1 accounts/)
  await upload(Buffer.from('{"meta":{"version":"9.9.9"}}'))
  await page.getByRole('button', { name: 'Import export' }).click()
  await expect(page.getByText(/Import rejected: meta\.version/)).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
})
