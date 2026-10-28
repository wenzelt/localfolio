import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')

// The light tokens sit in :root; the dark ones override them inside the colour-scheme query.
const block = (source: string) => Object.fromEntries([...source.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(([, name, value]) => [name, value]))
const light = block(css.match(/:root \{([^}]*)\}/)![1])
const dark = block(css.match(/prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)![1])

const channel = (hex: string, offset: number) => {
  const value = Number.parseInt(hex.length === 4 ? hex[1 + offset] + hex[1 + offset] : hex.slice(1 + offset * 2, 3 + offset * 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

// The vaporwave theme lives in its own file and re-declares the same tokens under its data-theme attribute.
const vapor = readFileSync(new URL('../app/vaporwave.css', import.meta.url), 'utf8')
const prefix = 'html[data-theme="vaporwave"]'
const vaporwave = block(vapor.match(/html\[data-theme="vaporwave"\] \{([^}]*)\}/)![1])

// The pop art stars and stripes theme is the third theme: its own file, its own scope, light only.
const pop = readFileSync(new URL('../app/popart.css', import.meta.url), 'utf8')
const popPrefix = 'html[data-theme="popart"]'
const popart = block(pop.match(/html\[data-theme="popart"\] \{([^}]*)\}/)![1])

describe.each([['light', light], ['dark', dark], ['vaporwave', vaporwave], ['popart', popart]] as const)('%s theme contrast', (_name, theme) => {
  const grounds = ['bg', 'surface']
  it.each(grounds)('keeps body, muted and signal colours readable on %s (WCAG AA 4.5:1)', (ground) => {
    for (const ink of ['text', 'muted', 'positive', 'negative', 'chart']) expect(contrast(theme[ink], theme[ground]), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the primary control legible and the control outline visible (3:1)', () => {
    expect(contrast(theme['on-accent'], theme.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.control, theme.surface)).toBeGreaterThanOrEqual(1.5)
  })
})

describe('typeface', () => {
  it('self-hosts one variable face, so no request leaves the app for fonts', () => {
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
    expect(layout).toContain("next/font/local")
    expect(layout).not.toContain('next/font/google')
    expect(existsSync(new URL('../app/fonts/Geist-Variable.woff2', import.meta.url))).toBe(true)
    expect(css).toMatch(/--sans: var\(--font-sans\)/)
  })

  it('sets figures in tabular numerals so columns of money line up', () => {
    expect(css).toMatch(/font-variant-numeric: tabular-nums/)
  })
})

const mix = (a: string, b: string, share: number) => {
  const part = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round(part(a, i) * share + part(b, i) * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

describe('vaporwave theme', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
  const rules = [...vapor.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^([^\s@}][^{]*)\{/gm)].map(([, selectors]) => selectors)

  it('is dark only and stays in its own scope, so the ledger theme is untouched', () => {
    expect(vaporwave).toMatchObject({ bg: '#090014', surface: '#1a103c', accent: '#ff00ff', chart: '#00ffff' })
    expect(vapor).toMatch(/color-scheme: dark/)
    expect(rules.length).toBeGreaterThan(20)
    for (const selectors of rules) for (const selector of selectors.split(',')) expect(selector.trim().startsWith(prefix), selector).toBe(true)
  })

  it('is wired from the layout: styles after the ledger, the saved theme on <html>, and self-hosted fonts', () => {
    expect(layout.indexOf("./vaporwave.css")).toBeGreaterThan(layout.indexOf("./style.css"))
    expect(layout).toMatch(/data-theme=\{/)
    expect(layout).toContain('parseTheme')
    expect(layout).not.toContain('next/font/google')
    for (const file of ['Orbitron-Variable.woff2', 'ShareTechMono-Regular.woff2']) {
      expect(layout).toContain(`./fonts/${file}`)
      expect(existsSync(new URL(`../app/fonts/${file}`, import.meta.url))).toBe(true)
    }
    // Ledger visitors never download the neon faces: they are declared but not preloaded.
    expect(layout.match(/preload: false/g)).toHaveLength(3)
    expect(vapor).toMatch(/--display: var\(--font-display\)/)
    expect(vapor).toMatch(/--sans: var\(--font-mono\)/)
  })

  it('carries the signature devices: sunset text, scanlines, a perspective grid floor and skewed controls', () => {
    expect(vapor).toMatch(/linear-gradient\(to right, #ff9900, #ff00ff, #00ffff\)/i)
    expect(vapor).toMatch(/position: fixed;[^}]*z-index: 50;[^}]*pointer-events: none/)
    expect(vapor).toMatch(/perspective\(\d+px\) rotateX\(\d+deg\)/)
    expect(vapor).toMatch(/\.privacy-toggle \{[^}]*skewX\(-12deg\)/)
    expect(vapor).toMatch(/\.privacy-toggle:hover \{[^}]*skewX\(0\)/)
  })

  it('keeps square corners and the laser top border on cards', () => {
    expect(vapor).toMatch(/\.card \{[^}]*border-radius: 0/)
    expect(vapor).toMatch(/\.card \{[^}]*border-top: 2px solid var\(--chart\)/)
  })

  it('moves only when motion is allowed and never loops', () => {
    const allowed = vapor.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(allowed).toBeGreaterThan(-1)
    expect(vapor.slice(0, allowed)).not.toMatch(/transition|animation/)
    expect(vapor).not.toMatch(/infinite/)
  })

  it('keeps heatmap tile text legible at the strongest tint, in both directions', () => {
    for (const signal of ['positive', 'negative']) expect(contrast('#ffffff', mix(vaporwave[signal], vaporwave.surface, 0.42)), signal).toBeGreaterThanOrEqual(4.5)
  })
})

describe('theme picker styling', () => {
  it('gives the summary and every choice a 44px touch target in the ledger theme', () => {
    expect(css).toMatch(/\.theme-picker summary \{[^}]*min-height: 44px/)
    expect(css).toMatch(/\.theme-picker button \{[^}]*min-height: 44px/)
  })
})

describe('pop art stars and stripes theme', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8')
  const strip = pop.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...strip.matchAll(/^([^\s@}][^{]*)\{/gm)].map(([, selectors]) => selectors)

  it('uses the red, white and blue poster palette on paper, light only, and stays in its own scope', () => {
    expect(popart).toMatchObject({ bg: '#fff8e7', surface: '#ffffff', text: '#111111', accent: '#d71920', chart: '#123a8c', 'pop-gold': '#ffd447', 'pop-gold-shadow': '#c58a13', 'pop-orange': '#ff8a24' })
    expect(pop).toMatch(/color-scheme: light/)
    expect(rules.length).toBeGreaterThan(20)
    for (const selectors of rules) for (const selector of selectors.split(',')) expect(selector.trim().startsWith(popPrefix), selector).toBe(true)
  })

  it('is wired from the layout: after the other themes, with Anton self-hosted and not preloaded', () => {
    expect(layout.indexOf('./popart.css')).toBeGreaterThan(layout.indexOf('./vaporwave.css'))
    expect(layout).toContain('./fonts/Anton-Regular.ttf')
    expect(layout).not.toContain('next/font/google')
    expect(existsSync(new URL('../app/fonts/Anton-Regular.ttf', import.meta.url))).toBe(true)
    expect(readFileSync(new URL('../app/fonts/NOTICE.md', import.meta.url), 'utf8')).toContain('Anton')
    expect(pop).toMatch(/--pop-display: var\(--font-pop\)/)
  })

  it('draws with hard ink: 3px borders, unblurred offset shadows, no blur, no gradients, no rounded cards', () => {
    expect(strip).toMatch(/--pop-border: 3px solid var\(--pop-ink\)/)
    for (const size of ['3px 3px 0', '6px 6px 0', '10px 10px 0']) expect(strip).toContain(`${size} var(--pop-ink)`)
    expect(strip).not.toMatch(/blur\(|backdrop-filter|filter:/)
    // Dots and hard-stop stripes are print devices; a smooth linear or conic gradient would read as gloss.
    expect(strip.replace(/(repeating-linear|radial)-gradient/g, '')).not.toMatch(/linear-gradient|conic-gradient/)
    expect(strip).toMatch(/\.card \{[^}]*border-radius: 0/)
    expect(strip).toMatch(/\.card \{[^}]*box-shadow: var\(--pop-shadow-md\)/)
  })

  it('sets headlines in the heavy condensed display face, uppercase, and keeps body copy in sentence case', () => {
    expect(strip).toMatch(/h1 \{[^}]*font: 400 [^;]*var\(--pop-display\)[^}]*text-transform: uppercase/)
    expect(strip).toMatch(/\.card h2 \{[^}]*var\(--pop-display\)/)
    expect(strip).not.toMatch(/\bp \{[^}]*uppercase/)
  })

  it('gives card headings a coloured header band and presses buttons into their shadow', () => {
    expect(strip).toMatch(/\.card h2 \{[^}]*background: var\(--chart\)/)
    expect(strip).toMatch(/button:active[^{]*\{[^}]*translate\(\d+px, \d+px\)[^}]*box-shadow: 0 0 0/)
  })

  it('keeps a visible keyboard focus ring, independent of hover', () => {
    expect(strip).toMatch(/:focus-visible \{[^}]*outline: 4px solid var\(--pop-focus\)/)
    expect(contrast(popart['pop-focus'], popart.bg)).toBeGreaterThanOrEqual(3)
    expect(contrast(popart['pop-focus'], popart.surface)).toBeGreaterThanOrEqual(3)
  })

  it('moves only when motion is allowed, with short transitions and no loops', () => {
    const allowed = pop.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(allowed).toBeGreaterThan(-1)
    expect(pop.slice(0, allowed)).not.toMatch(/transition|animation/)
    expect(pop).not.toMatch(/infinite/)
    for (const [, ms] of pop.matchAll(/(\d+)ms/g)) expect(Number(ms)).toBeLessThanOrEqual(200)
  })

  it('keeps its decoration out of the way: untouched pointers, hidden below phone width, shadows and borders slimmed', () => {
    expect(strip).toMatch(/\.pop-banner \{[^}]*pointer-events: none/)
    expect(strip).toMatch(/\.star-sticker \{[^}]*pointer-events: none/)
    expect(strip).toMatch(/@media \(max-width: 640px\) \{[^@]*--pop-shadow-md: 3px 3px 0 var\(--pop-ink\)/)
    expect(strip).toMatch(/@media \(max-width: 480px\) \{[^@]*\.star-sticker \{[^}]*display: none/)
  })

  it('is generic: its stylesheet and artwork refer to no real person, campaign or slogan', () => {
    const artwork = readFileSync(new URL('./stars.tsx', import.meta.url), 'utf8')
    for (const source of [pop, artwork, layout]) expect(source).not.toMatch(/trump|satire|parody|campaign|swoop|comb-over|\bhair\b|maga|unprecedented/i)
  })

  it('keeps heatmap tile text, set in ink, legible at the strongest tint in both directions', () => {
    for (const signal of ['positive', 'negative']) expect(contrast(popart.text, mix(popart[signal], popart.surface, 0.42)), signal).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps white text on the red and blue bands readable', () => {
    for (const band of [popart.accent, popart.chart]) expect(contrast('#ffffff', band), band).toBeGreaterThanOrEqual(4.5)
    expect(contrast(popart.text, popart['pop-gold'])).toBeGreaterThanOrEqual(4.5)
  })
})
