import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BuyView } from './buy-view'
import { Dashboard, LoginForm } from './dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Localfolio branding', () => {
  it('uses localfolio as the package name in both manifests', () => {
    expect(JSON.parse(read('../package.json')).name).toBe('localfolio')
    const lock = JSON.parse(read('../package-lock.json'))
    expect(lock.name).toBe('localfolio')
    expect(lock.packages[''].name).toBe('localfolio')
  })

  it('names the project in the README and browser title', () => {
    expect(read('../README.md')).toMatch(/^# Localfolio\n/)
    expect(read('../app/layout.tsx')).toContain("title: 'Localfolio'")
  })

  it('shows Localfolio on the dashboard, login and buy page', () => {
    for (const view of [<Dashboard key="dashboard" report={null} />, <LoginForm key="login" error={false} />, <BuyView key="buy" accounts={[]} today="2026-03-02" />]) {
      expect(renderToStaticMarkup(view)).toMatch(/class="brand"[\s\S]*?Localfolio/)
    }
  })
})
