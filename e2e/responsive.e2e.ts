import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { e2e } from './env'

const widths = [320, 375, 414, 768, 1024, 1280, 1920]
const phone = 480

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
}

// Describes everything that breaks a responsive layout, as readable strings
async function layoutProblems(page: Page) {
  return page.evaluate((phoneMax) => {
    const problems: string[] = []
    const viewport = window.innerWidth
    const describe = (element: Element) => `${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className ? `.${element.className.split(' ')[0]}` : ''} "${(element.textContent ?? '').trim().slice(0, 30)}"`
    if (document.documentElement.scrollWidth > viewport) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${viewport}`)
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      if (box.width === 0 || box.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue
      if (element.closest('details:not([open])') && !element.closest('summary')) continue
      if (box.right > viewport + 1 || box.left < -1) problems.push(`outside viewport: ${describe(element)} (${Math.round(box.left)}..${Math.round(box.right)})`)
      if (viewport <= phoneMax) {
        const interactive = element.matches('a[href], button, select, input:not([type=hidden]), summary, [role=button], [role=tab]')
        if (interactive && box.height < 44) problems.push(`touch target under 44px: ${describe(element)} (${Math.round(box.width)}x${Math.round(box.height)})`)
        const hasOwnText = [...element.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim())
        if (hasOwnText && parseFloat(style.fontSize) < 12) problems.push(`text under 12px: ${describe(element)} (${style.fontSize})`)
      }
    }
    return [...new Set(problems)]
  }, phone)
}

for (const width of widths) {
  test.describe(`responsive layout at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 700 ? 800 : 900 }, hasTouch: width <= phone })

    test('login fits the screen', async ({ page }) => {
      await page.goto('/login')
      await page.screenshot({ path: `test-results/responsive/login-${width}.png`, fullPage: true })
      expect(await layoutProblems(page)).toEqual([])
    })

    test('dashboard fits the screen, also with sources open and amounts hidden', async ({ page }) => {
      await signIn(page)
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `test-results/responsive/dashboard-${width}.png`, fullPage: true })
      expect(await layoutProblems(page), 'dashboard').toEqual([])
      await page.getByText('Sources and dates', { exact: true }).click()
      expect(await layoutProblems(page), 'dashboard with sources open').toEqual([])
      await page.goto('/?hide=1')
      expect(await layoutProblems(page), 'hidden amounts').toEqual([])
    })

    test('the vaporwave theme fits the screen too, also with the theme picker open', async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: 'vaporwave', url: baseURL as string }])
      await page.goto('/login')
      expect(await layoutProblems(page), 'vaporwave login').toEqual([])
      await page.getByLabel('Password').fill(e2e.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
      expect(await layoutProblems(page), 'vaporwave dashboard').toEqual([])
      await page.locator('.theme-picker summary').click()
      expect(await layoutProblems(page), 'vaporwave with picker open').toEqual([])
      await page.goto('/?hide=1')
      expect(await layoutProblems(page), 'vaporwave hidden amounts').toEqual([])
    })

    test('the pop art theme fits the screen too, and its artwork never covers a control or a figure', async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'theme', value: 'popart', url: baseURL as string }])
      await page.goto('/login')
      expect(await layoutProblems(page), 'pop art login').toEqual([])
      await page.getByLabel('Password').fill(e2e.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `test-results/responsive/popart-${width}.png`, fullPage: true })
      expect(await layoutProblems(page), 'pop art dashboard').toEqual([])
      const covered = await page.evaluate(() => {
        const art = [...document.querySelectorAll('.hair-sticker, .pop-banner')].filter((element) => getComputedStyle(element).display !== 'none')
        const targets = [...document.querySelectorAll('a[href], button, select, input, summary, .value, .stats, .label, h1, h2')].filter((element) => !element.closest('.pop-banner, .hair-sticker, details:not([open])') || element.matches('summary'))
        const hits: string[] = []
        for (const piece of art) for (const target of targets) {
          const a = piece.getBoundingClientRect(), b = target.getBoundingClientRect()
          if (b.width && b.height && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) hits.push(`${piece.className.split(' ')[0]} covers ${target.tagName.toLowerCase()}.${(target.className || '').toString().split(' ')[0]}`)
        }
        return hits
      })
      expect(covered, 'artwork over content').toEqual([])
      await page.locator('.theme-picker summary').click()
      expect(await layoutProblems(page), 'pop art with picker open').toEqual([])
      await page.goto('/?hide=1')
      expect(await layoutProblems(page), 'pop art hidden amounts').toEqual([])
    })
  })
}
