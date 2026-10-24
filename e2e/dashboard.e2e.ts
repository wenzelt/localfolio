import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { e2e } from './env'

async function signIn(page: Page, path = '/') {
  await page.goto('/login')
  await page.getByLabel('Password').fill(e2e.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  if (path !== '/') await page.goto(path)
  // Interactions fired before React has hydrated are silently lost, so wait for it
  await page.waitForFunction(() => Object.keys(document.querySelector('main') as Element).some((key) => key.startsWith('__reactFiber')))
}

test.describe('Story 14: populated country exposure', () => {
  for (const width of [1280, 375]) {
    test(`map and text agree, sources are visible, hide mode works at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await signIn(page)
      const card = page.getByRole('region', { name: 'Country exposure' })
      await expect(card).toBeVisible()
      for (const country of ['United States', 'Germany']) {
        const row = card.locator('li').filter({ has: page.locator('span', { hasText: new RegExp(`^${country}$`) }) })
        const percentage = (await row.innerText()).match(/\d+\.\d{2}%/)![0]
        await expect(card.locator('svg path').filter({ has: page.locator('title', { hasText: `${country}: ${percentage}` }) })).toHaveClass('country-known')
      }
      await expect(card.getByText('Other / not broken down', { exact: true })).toBeVisible()
      await card.getByText('Sources and dates', { exact: true }).click()
      await expect(card.getByRole('link', { name: /^Source/ })).toHaveCount(2)
      await expect(card).toContainText('EUETF')
      await expect(card).toContainText('Stale country weights')
      await expect(card).toContainText('Current country weights')
      await expect(card).toContainText('Last fetched:')
      await expect(card).toContainText('€')
      const overflowing = await page.evaluate(() => [...document.querySelectorAll('main *')].filter((element) => element.getBoundingClientRect().right > window.innerWidth).map((element) => `${element.tagName}.${element.className}: ${Math.round(element.getBoundingClientRect().right)}`).slice(0, 12))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), overflowing.join(', ')).toBe(true)
      await page.getByRole('link', { name: 'Hide values' }).click()
      await expect(card).not.toContainText('€')
      await expect(card).toContainText('%')
    })
  }
})

test.describe('sign in', () => {
  test('a visitor without a session is sent to the login page and a wrong password is refused', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await page.getByLabel('Password').fill('wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Incorrect password')
  })
})

test.describe('Story 10: hide sensitive figures', () => {
  test('masks amounts, keeps percentages, and carries hide=1 through timeframe changes and position navigation', async ({ page }) => {
    await signIn(page)
    const shown = (await page.locator('.value').first().innerText()).trim()
    expect(shown).toContain('€')

    await page.getByRole('link', { name: 'Hide values' }).click()
    await expect(page).toHaveURL(/hide=1/)
    await expect(page.locator('.value').first().getByRole('img', { name: 'Value hidden' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(shown)
    await expect(page.locator('main')).toContainText('%')
    const labels = await page.locator('[title],[aria-label]').evaluateAll((elements) =>
      elements.flatMap((element) => [element.getAttribute('title'), element.getAttribute('aria-label')]).filter(Boolean))
    expect(labels.filter((label) => /€/.test(label as string))).toEqual([])

    await page.getByLabel('Timeframe').selectOption('1Y')
    await expect(page).toHaveURL(/period=1Y/)
    await expect(page).toHaveURL(/hide=1/)
    await expect(page.locator('.value').first().getByRole('img', { name: 'Value hidden' })).toBeVisible()

    await page.getByRole('link', { name: /Synthetic EU ETF/ }).first().click()
    await expect(page).toHaveURL(/hide=1/)
    await expect(page.getByRole('heading', { name: 'Synthetic EU ETF' })).toBeVisible()
    await expect(page.locator('dd', { hasText: '12.5' })).toHaveCount(0)
    const details = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Position', exact: true }) }).locator('dl')
    await expect(details.getByRole('img', { name: 'Value hidden' })).toHaveCount(2)
    await expect(details).not.toContainText('€')

    await page.getByRole('link', { name: 'Show values' }).click()
    await expect(page.locator('.value').first()).toContainText('€')
  })
})

test.describe('Story 11: inspect an individual position', () => {
  test('lists open positions only, opens a holding, and returns not found for an unknown position', async ({ page }) => {
    await signIn(page)
    const overview = page.locator('main')
    await expect(overview).toContainText('Synthetic EU ETF')
    await expect(overview).toContainText('Synthetic US Stock')
    await expect(overview).not.toContainText('Synthetic Closed Fund')
    await expect(overview).not.toContainText('Synthetic Excluded Fund')

    await page.getByRole('link', { name: /Synthetic EU ETF/ }).first().click()
    await expect(page).toHaveURL(/account=.+&symbol=EUETF/)
    await expect(page.getByRole('heading', { name: 'Synthetic EU ETF' })).toBeVisible()
    await expect(page.locator('dt', { hasText: 'Quantity' })).toBeVisible()
    await expect(page.locator('dd', { hasText: '12.5' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to portfolio' }).click()
    await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()

    const response = await page.goto('/?account=00000000-0000-0000-0000-000000000000&symbol=NOPE')
    expect(response?.status()).toBe(404)
  })

  test('shows a USD holding with its EUR and native USD figures, and a USD chart price', async ({ page }) => {
    await signIn(page)
    await page.getByRole('link', { name: /Synthetic US Stock/ }).first().click()
    await expect(page.locator('dt', { hasText: 'Cost basis · EUR' })).toBeVisible()
    await expect(page.locator('div', { has: page.locator('dt', { hasText: 'Cost basis · USD' }) }).last().locator('dd')).toHaveText('$1,000.00')
    await expect(page.locator('div', { has: page.locator('dt', { hasText: 'Value · USD' }) }).last().locator('dd')).toHaveText(/^\$[\d,]+\.\d{2}$/)
    await expect(page.locator('.readout')).toContainText('USD')
    await page.getByRole('link', { name: 'Hide values' }).click()
    await expect(page.locator('dt', { hasText: 'Value · USD' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('$')
  })
})

test.describe('Story 12: update filters without pressing Apply', () => {
  test('changing the timeframe navigates at once and keeps other parameters', async ({ page }) => {
    await signIn(page, '/?hide=1')
    await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0)
    await page.getByLabel('Timeframe').selectOption('YTD')
    await expect(page).toHaveURL(/period=YTD/)
    await expect(page).toHaveURL(/hide=1/)
    await expect(page.getByLabel('Timeframe')).toHaveValue('YTD')
  })

  test('rapid successive changes settle on the last choice', async ({ page }) => {
    await signIn(page)
    const timeframe = page.getByLabel('Timeframe')
    await timeframe.selectOption('1Y')
    await timeframe.selectOption('MTD')
    await expect(page).toHaveURL(/period=MTD/)
    await expect(page.getByLabel('Timeframe')).toHaveValue('MTD')
  })
})

test.describe('Story 12b: switching timeframe keeps the page still', () => {
  test('shows a spinner instead of text, never moves anything, and redraws the chart', async ({ page }) => {
    await signIn(page)
    await page.route(/period=/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })
    const timeframe = page.getByLabel('Timeframe')
    const tracked = ['.period', '.period select', '.summary .value', '.chart', '.readout', '.dates', '.panels']
    const boxes = () => page.evaluate((selectors) => selectors.map((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect()
      return box ? [box.x, box.y, box.width, box.height].map(Math.round) : null
    }), tracked)
    const before = await boxes()
    await timeframe.focus()
    await timeframe.selectOption('YTD')
    await expect(page.locator('.period[aria-busy="true"]')).toHaveCount(1)
    await expect(page.locator('.period .spinner')).toBeVisible()
    await expect(page.locator('.period').getByRole('status')).toHaveText('Updating')
    expect(await page.locator('.period-status').boundingBox()).toMatchObject({ width: 18, height: 18 })
    expect(await boxes()).toEqual(before)
    await expect(page).toHaveURL(/period=YTD/)
    await expect(page.locator('.period[aria-busy="true"]')).toHaveCount(0)
    expect((await boxes()).slice(0, 2)).toEqual(before.slice(0, 2))
    await expect(timeframe).toBeFocused()
    await expect(page.locator('.chart-reveal')).toHaveCSS('animation-name', 'chart-reveal')
  })

  test('replays the chart reveal each time the timeframe changes', async ({ page }) => {
    await signIn(page)
    await page.evaluate(() => {
      const mark = document.querySelector('.chart-reveal')
      ;(window as unknown as { __chart: Element | null }).__chart = mark
    })
    await page.getByLabel('Timeframe').selectOption('1Y')
    await expect(page).toHaveURL(/period=1Y/)
    await expect.poll(() => page.evaluate(() => document.querySelector('.chart-reveal') !== (window as unknown as { __chart: Element | null }).__chart)).toBe(true)
  })
})

test.describe('Story 13: chart readout', () => {
  test('pointer and keyboard select a date, and leaving or Escape returns to the latest', async ({ page }) => {
    await signIn(page)
    const readout = page.locator('.readout')
    const latest = (await readout.textContent()) ?? ''
    const box = await page.getByRole('img', { name: 'Portfolio performance' }).boundingBox()
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height / 2)
    await expect(readout).not.toHaveText(latest)
    await page.mouse.move(0, 0)
    await expect(readout).toHaveText(latest)

    const slider = page.getByRole('slider', { name: 'Select date' })
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(readout).not.toHaveText(latest)
    await page.keyboard.press('Escape')
    await expect(readout).toHaveText(latest)
  })

  test('hidden mode masks the readout amounts but keeps the date and percentage', async ({ page }) => {
    await signIn(page, '/?hide=1')
    const readout = page.locator('.readout')
    const box = await page.getByRole('img', { name: 'Portfolio performance' }).boundingBox()
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height / 2)
    await expect(readout).not.toContainText('€')
    await expect(readout.getByRole('img', { name: 'Value hidden' }).first()).toBeVisible()
    await expect(readout.locator('time')).toHaveText(/^\d{4}-\d{2}-\d{2}$/)
    await expect(readout).toContainText('%')
  })
})

test.describe('Story 8: open dashboard refreshes by itself', () => {
  test('requests fresh data after a minute while the tab is visible', async ({ page }) => {
    await page.clock.install()
    await signIn(page)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-live-refresh]')).toContainText(/Updated \d{1,2}:\d{2}/)
    const refreshed = page.waitForRequest((request) => request.headers().rsc === '1')
    await page.clock.fastForward(61_000)
    await refreshed
    await expect(page.getByRole('heading', { name: 'Your portfolio' })).toBeVisible()
  })
})

test.describe('Theme picker', () => {
  test('switches to Vaporwave, keeps the choice across a reload, and switches back', async ({ page }) => {
    await signIn(page)
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'ledger')
    await page.locator('.theme-picker summary').click()
    await page.getByRole('button', { name: /Vaporwave/ }).click()
    await expect(html).toHaveAttribute('data-theme', 'vaporwave')
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'vaporwave')
    await page.locator('.theme-picker summary').click()
    await expect(page.getByRole('button', { name: /Vaporwave/ })).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: /Ledger/ }).click()
    await expect(html).toHaveAttribute('data-theme', 'ledger')
  })

  test('switches to Pop Art with its parody note, keeps the choice across a reload, and the figures stay put', async ({ page }) => {
    await signIn(page)
    const html = page.locator('html')
    const figure = await page.locator('.value').innerText()
    await page.locator('.theme-picker summary').click()
    await page.getByRole('button', { name: /Pop Art/ }).click()
    await expect(html).toHaveAttribute('data-theme', 'popart')
    await expect(page.getByText('Independent satire. Not affiliated with or endorsed by Donald Trump or any political campaign.')).toBeVisible()
    await expect(page.locator('.pop-banner')).toBeVisible()
    await expect(page.locator('.value')).toHaveText(figure)
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'popart')
    await page.locator('.theme-picker summary').click()
    await expect(page.getByRole('button', { name: /Pop Art/ })).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: /Ledger/ }).click()
    await expect(html).toHaveAttribute('data-theme', 'ledger')
    await expect(page.locator('.pop-banner')).toHaveCount(0)
  })

  test('closes on Escape and hands focus back to the Theme button', async ({ page }) => {
    await signIn(page)
    const picker = page.locator('.theme-picker')
    await picker.locator('summary').click()
    await expect(picker).toHaveJSProperty('open', true)
    await page.keyboard.press('Escape')
    await expect(picker).toHaveJSProperty('open', false)
    await expect(picker.locator('summary')).toBeFocused()
  })

  test('closes on a click away, and opening it is not mistaken for one', async ({ page }) => {
    await signIn(page)
    const picker = page.locator('.theme-picker')
    await picker.locator('summary').click()
    await expect(picker).toHaveJSProperty('open', true)
    await page.getByRole('heading', { name: 'Your portfolio' }).click()
    await expect(picker).toHaveJSProperty('open', false)
  })

  test('closes when keyboard focus leaves the menu', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari tabs only to form controls unless a system setting is on, so buttons never take Tab focus')
    await signIn(page)
    const picker = page.locator('.theme-picker')
    await picker.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(picker).toHaveJSProperty('open', true)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: /Ledger/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: /Vaporwave/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: /Pop Art/ })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeFocused()
    await expect(picker).toHaveJSProperty('open', false)
  })

  test('can be used from the keyboard alone', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Safari tabs only to form controls unless a system setting is on, so buttons never take Tab focus')
    await signIn(page)
    await page.getByRole('link', { name: /Hide values/ }).focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('.theme-picker summary')).toBeFocused()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: /Vaporwave/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'vaporwave')
  })

  test('exposes its name, choices and current choice to assistive technology', async ({ page }) => {
    await signIn(page)
    await page.locator('.theme-picker summary').click()
    const tree = await page.locator('.theme-picker').ariaSnapshot()
    expect(tree).toContain('Theme')
    expect(tree).toMatch(/button "Ledger Calm ink, light or dark"/)
    expect(tree).toMatch(/button "Vaporwave Neon outrun, always dark"/)
    expect(tree).not.toContain('✓')
    await expect(page.getByRole('button', { name: /Ledger/ })).toHaveAttribute('aria-current', 'true')
  })

  test('Vaporwave effects are applied by this browser engine', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'theme', value: 'vaporwave', url: baseURL as string }])
    await signIn(page)
    await page.evaluate(() => document.fonts.ready)
    const applied = await page.evaluate(() => {
      const style = (element: Element, pseudo?: string) => getComputedStyle(element, pseudo) as CSSStyleDeclaration & Record<string, string>
      const card = style(document.querySelector('.card') as Element)
      const heading = style(document.querySelector('h1') as Element)
      const grid = style(document.body, '::before')
      const scan = style(document.body, '::after')
      return {
        blur: card.backdropFilter || card.webkitBackdropFilter,
        clip: heading.webkitBackgroundClip || heading.backgroundClip,
        headingColour: heading.color,
        gradient: heading.backgroundImage,
        mask: grid.maskImage || grid.webkitMaskImage,
        perspective: grid.transform,
        scanlines: { position: scan.position, events: scan.pointerEvents, z: scan.zIndex },
        radius: card.borderTopLeftRadius,
        fontsLoaded: [...document.fonts].filter((face) => face.status === 'loaded').length,
      }
    })
    expect(applied.blur).toMatch(/blur/)
    expect(applied.clip).toBe('text')
    expect(applied.headingColour).toBe('rgba(0, 0, 0, 0)')
    expect(applied.gradient).toMatch(/linear-gradient/)
    expect(applied.mask).toMatch(/linear-gradient/)
    expect(applied.perspective).toMatch(/^matrix3d/)
    expect(applied.scanlines).toEqual({ position: 'fixed', events: 'none', z: '50' })
    expect(applied.radius).toBe('0px')
    expect(applied.fontsLoaded).toBeGreaterThanOrEqual(2)
  })
})
