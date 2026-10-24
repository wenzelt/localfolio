import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGhostfolioJson } from './ghostfolio'
import { positionsTemplate } from './positions-csv'

const root = new URL('../', import.meta.url).pathname
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const readme = () => read('README.md')

describe('README for first-time hosts', () => {
  it('ships an MIT license that package.json declares', () => {
    expect(read('LICENSE')).toMatch(/^MIT License\n/)
    expect(read('LICENSE')).toContain('Permission is hereby granted, free of charge')
    expect(JSON.parse(read('package.json')).license).toBe('MIT')
  })

  it('shows the exact DATABASE_URL line for the host-side import', () => {
    expect(readme()).toContain('DATABASE_URL=postgres://portfolio:<POSTGRES_PASSWORD>@127.0.0.1:55432/portfolio')
  })

  it('tells the operator how to sign in and what an empty dashboard means', () => {
    expect(readme()).toMatch(/sign in with the `APP_PASSWORD`/i)
    expect(readme()).toMatch(/empty until/i)
  })

  it('gives the one-off ledger-driven price refresh command', () => {
    expect(readme()).toContain('docker compose run --rm --entrypoint python worker -m worker.refresh')
  })

  it('explains where the Ghostfolio export comes from and links a sample that actually parses', () => {
    expect(readme()).toContain('docs/examples/ghostfolio-export.sample.json')
    expect(readme()).toMatch(/no Ghostfolio/i)
    const sample = parseGhostfolioJson(read('docs/examples/ghostfolio-export.sample.json'))
    expect(sample.activities.length).toBeGreaterThan(0)
  })

  it('documents the CSV positions import with the exact template header', () => {
    expect(readme()).toContain('Import positions')
    expect(readme()).toContain(positionsTemplate.split('\n')[0])
  })

  it('scopes the Node.js requirement to the host-side commands', () => {
    expect(readme()).not.toContain('for the checks below')
    expect(readme()).toMatch(/Node\.js 26[^\n]*host/)
  })

  it('has a troubleshooting section for port clashes, login failures and Yahoo limits', () => {
    const section = readme().split('## Troubleshooting')[1]?.split('\n## ')[0] ?? ''
    for (const text of ['port is already allocated', 'Incorrect password', 'DATABASE_URL is required', 'rate limit']) expect(section).toContain(text)
  })

  it('links only to files that exist', () => {
    const links = [...readme().matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map((match) => match[1])
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(existsSync(resolve(dirname(resolve(root, 'README.md')), link)), link).toBe(true)
  })
})

describe('docs no longer contradict the shipped app', () => {
  it('does not claim the dashboard is missing or that the app never imports', () => {
    expect(read('docs/yfinance-worker.md')).not.toContain('no web dashboard exists yet')
    expect(read('docs/dashboard.md')).not.toContain('it does not import data')
  })
})
