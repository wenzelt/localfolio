import { readFileSync } from 'node:fs'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ErrorNotice } from './error-notice'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const withDigest = (message: string, digest: string) => Object.assign(new Error(message), { digest })
const page = (error: unknown, retry: () => void = () => {}) => renderToStaticMarkup(<ErrorNotice error={error} retry={retry} />)

type Clickable = ReactElement<{ children?: ReactNode; onClick?: () => void }>
function findButton(node: ReactNode): Clickable | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map(findButton).find(Boolean)
  const element = node as Clickable
  return element.type === 'button' ? element : findButton(element.props?.children)
}

describe('error page', () => {
  it('names a stopped database as the likely cause and shows how to check and start it', () => {
    const html = page(withDigest('boom', '1381160836'))
    expect(html).toContain('database is not running')
    expect(html).toContain('docker compose ps')
    expect(html).toContain('docker compose up -d --wait db')
  })

  it('shows the error reference and where to find the matching line in the app log', () => {
    const html = page(withDigest('boom', '1381160836'))
    expect(html).toContain('1381160836')
    expect(html).toContain('docker compose --profile app logs app')
  })

  it('leaves the reference out when the error carries none', () => {
    for (const error of [new Error('boom'), 'boom', null, undefined, { digest: 5 }, Object.assign(new Error('boom'), { digest: 5 })]) {
      expect(page(error), String(error)).not.toContain('Error reference')
    }
  })

  it('never prints the error message, which can name hosts, users or queries', () => {
    const html = page(withDigest('password authentication failed for user "portfolio" at db:5432', '42'))
    for (const leaked of ['password authentication', 'portfolio', 'db:5432']) expect(html).not.toContain(leaked)
  })

  it('offers a retry that calls the retry function Next provides', () => {
    const retry = vi.fn()
    const button = findButton(ErrorNotice({ error: new Error('boom'), retry }))
    expect(button?.props.children).toBe('Try again')
    button?.props.onClick?.()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('is mounted as the app error boundary, which Next requires to be a client component', () => {
    const file = read('app/error.tsx')
    expect(file.startsWith("'use client'")).toBe(true)
    expect(file).toContain('ErrorNotice')
    expect(file).toContain('export default')
  })
})
