import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { e2e } from './env'

test('Export transactions downloads the ledger as a CSV file, and only for a signed-in owner', async ({ page, request }) => {
  // Without a session the endpoint hands out nothing.
  const refused = await request.get('/api/transactions/export')
  expect(refused.status()).toBe(401)
  expect(await refused.text()).not.toContain('Main broker')

  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export transactions' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^localfolio-transactions-\d{4}-\d{2}-\d{2}\.csv$/)

  // Other browser tests add rows to the same schema, so look for the seeded rows rather than counting.
  const csv = (await readFile(await file.path(), 'utf8')).replace(/^﻿/, '')
  const lines = csv.split('\r\n')
  expect(lines[0]).toBe('date,account,type,symbol,quantity,unit_price,fee,currency,comment,tags')
  expect(lines).toContainEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z,Main broker,BUY,EUETF,12\.5,100,0,EUR,,$/))
  expect(lines).toContainEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z,Main broker,SELL,CLOSED,3,55,0,EUR,,$/))
  // The export is a record of the ledger, so it includes an account the dashboard leaves out of its totals.
  expect(lines).toContainEqual(expect.stringMatching(/,Excluded broker,BUY,HIDDEN,4,80,0,EUR,,$/))
  expect(lines.at(-1)).toBe('')

  // The page the owner was on stays where it was.
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
})
