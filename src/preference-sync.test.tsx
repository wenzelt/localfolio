import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const effects = vi.hoisted(() => ({ run: [] as (() => void)[] }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => { effects.run.push(effect) },
}))
import { PreferenceSync } from './preference-sync'

describe('saving the resolved preferences in the browser', () => {
  it('renders nothing and saves period and hide after mount', () => {
    const page = { cookie: '' }
    const writes: string[] = []
    Object.defineProperty(page, 'cookie', { set: (v: string) => writes.push(v) })
    vi.stubGlobal('document', page)
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(renderToStaticMarkup(<PreferenceSync period="1Y" hidden />)).toBe('')
    for (const effect of effects.run) effect()
    expect(writes).toEqual([
      'view_period=1Y; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
      'view_hide=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure',
    ])
    vi.unstubAllGlobals()
  })
})
