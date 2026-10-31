import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('web deployment packaging', () => {
  it('builds a standalone Next server and runs as a non-root user', () => {
    expect(read('next.config.ts')).toContain("output: 'standalone'")
    const dockerfile = read('Dockerfile')
    expect(dockerfile).toContain('npm ci')
    expect(dockerfile).toContain('npm run build')
    expect(dockerfile).toContain('/app/.next/standalone')
    expect(dockerfile).toContain('/app/.next/static')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('["node", "server.js"]')
  })

  it('packages every worker runtime module into the worker image', () => {
    const copied = read('worker/Dockerfile').match(/^COPY --chown=worker:worker (.+) worker\/$/m)?.[1].split(' ')
    const modules = readdirSync(new URL('../worker/', import.meta.url)).filter((file) => file.endsWith('.py') && !file.startsWith('test_'))
    expect(copied?.sort()).toEqual(modules.sort())
    expect(read('worker/Dockerfile')).toContain('COPY --chown=worker:worker country-funds.json fund-country-weights.json worker/')
  })

  it('disables Python output buffering for all worker entrypoints', () => {
    expect(read('worker/Dockerfile')).toMatch(/^ENV PYTHONUNBUFFERED=1$/m)
  })

  it('keeps credentials, private exports and build artifacts out of the context', () => {
    const ignore = read('.dockerignore').split('\n')
    for (const path of ['.env', '.env.*', 'private', '.git', 'node_modules', '.next', '.venv']) expect(ignore).toContain(path)
  })

  it('keeps database dumps and the deploy handoff out of Git', () => {
    const ignore = read('.gitignore').split('\n')
    for (const path of ['*.dump', 'DEPLOY-HANDOFF.md']) expect(ignore).toContain(path)
    expect(ignore).toContain('!.env.example')
  })

  it('keeps database dumps and the deploy handoff out of Docker builds', () => {
    const ignore = read('.dockerignore').split('\n')
    for (const path of ['*.dump', '**/*.dump', 'DEPLOY-HANDOFF.md']) expect(ignore).toContain(path)
  })

  it('defaults the opt-in web service to loopback without requiring web settings for workers', () => {
    const compose = read('compose.yaml')
    expect(compose).toContain('  app:')
    expect(compose).toContain('profiles: ["app"]')
    expect(compose).toContain('${APP_BIND_IP:-127.0.0.1}:3000:3000')
    expect(compose).toContain('${APP_PASSWORD:-}')
    expect(compose).toContain('${SESSION_SECRET:-}')
    expect(compose).toContain('PGHOST: db')
  })

  it('health-checks the web service through its unauthenticated health endpoint', () => {
    const compose = read('compose.yaml')
    const app = compose.slice(compose.indexOf('  app:'), compose.indexOf('  worker:'))
    expect(app).toContain('healthcheck:')
    expect(app).toContain('/api/health')
  })
})

describe('live refresh packaging', () => {
  it('runs the light intraday refresh as its own opt-in service, every five minutes by default', () => {
    const compose = read('compose.yaml')
    const live = compose.slice(compose.indexOf('  live:'), compose.indexOf('\nvolumes:'))
    expect(live).toContain('profiles: ["live"]')
    expect(live).toContain('restart: unless-stopped')
    expect(live).toContain('"--intraday"')
    expect(live).toContain('LIVE_REFRESH_INTERVAL_SECONDS:-300}')
    expect(live).toContain('PGHOST: db')
    expect(read('.env.example')).toMatch(/^# LIVE_REFRESH_INTERVAL_SECONDS=300$/m)
  })
})

describe('operator documentation', () => {
  it('ships a placeholder-only .env.example covering every variable compose requires', () => {
    const example = read('.env.example')
    for (const name of ['POSTGRES_PASSWORD', 'APP_PASSWORD', 'SESSION_SECRET', 'APP_BIND_IP']) expect(example).toMatch(new RegExp(`^${name}=`, 'm'))
    expect(example).not.toMatch(/^(POSTGRES_PASSWORD|APP_PASSWORD|SESSION_SECRET)=\S/m)
  })

  it('documents setup, startup, upgrade, TLS, health, backup, restore, provider limits and release checks', () => {
    const readme = read('README.md')
    for (const text of [
      '.env.example', 'docker compose --profile app up -d --build', 'npm run import:ghostfolio --', '## Upgrading', '## Reverse proxy and TLS', '/api/health',
      '## Backup and restore', 'pg_dump', 'psql', 'yfinance', 'rate limit', 'npm run test:coverage', 'npm run typecheck', 'npm run lint',
    ]) expect(readme).toContain(text)
  })

  it('defines every npm script the README tells the operator to run', () => {
    const scripts = JSON.parse(read('package.json')).scripts
    for (const name of ['test:coverage', 'typecheck', 'lint']) expect(scripts[name]).toBeTruthy()
  })
})

// One service's block in compose.yaml: its "  name:" line and everything indented under it.
function service(name: string): string {
  const lines = read('compose.yaml').split('\n')
  const start = lines.indexOf(`  ${name}:`)
  if (start === -1) throw new Error(`compose.yaml has no ${name} service`)
  let end = start + 1
  while (end < lines.length && (lines[end] === '' || lines[end].startsWith('    '))) end += 1
  return lines.slice(start, end).join('\n')
}

describe('compose service contract', () => {
  const longRunning = ['db', 'app', 'scheduler', 'live']
  const databaseClients = ['app', 'worker', 'scheduler', 'live']

  it('restarts every long-running service after Docker or the host restarts, so the app never outlives its database', () => {
    for (const name of longRunning) expect(service(name), name).toMatch(/^ {4}restart: unless-stopped$/m)
  })

  it('does not restart the one-shot worker, which runs only when asked', () => {
    expect(service('worker')).not.toContain('restart:')
  })

  it('starts the database first and waits until it is healthy', () => {
    for (const name of databaseClients) expect(service(name), name).toMatch(/depends_on:\n {6}db:\n {8}condition: service_healthy/)
    expect(service('db')).toContain('pg_isready -U portfolio -d portfolio')
  })

  it('keeps the data in a named volume that a rebuild does not remove', () => {
    expect(service('db')).toContain('- portfolio-db:/var/lib/postgresql/data')
    expect(read('compose.yaml')).toMatch(/^volumes:\n {2}portfolio-db:\s*$/m)
    expect(read('compose.yaml')).not.toContain('tmpfs')
  })

  it('pins the database image to a major version, so a rebuild cannot move the data directory to a newer server', () => {
    expect(service('db')).toMatch(/^ {4}image: postgres:\d+(-alpine)?$/m)
  })

  it('publishes the database port on loopback only', () => {
    expect(service('db')).toContain('"127.0.0.1:55432:5432"')
  })

  it('gives the database and every client the same name, user and password source', () => {
    const db = service('db')
    for (const line of ['POSTGRES_USER: portfolio', 'POSTGRES_DB: portfolio', 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}']) expect(db).toContain(line)
    for (const name of databaseClients) {
      const block = service(name)
      for (const line of ['PGHOST: db', 'PGUSER: portfolio', 'PGDATABASE: portfolio', 'PGPASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}']) expect(block, name).toContain(line)
    }
  })

  it('clears DATABASE_URL in containers, so a host-side value pointing at 127.0.0.1 cannot override the PG settings', () => {
    for (const name of databaseClients) expect(service(name), name).toContain('DATABASE_URL: ""')
  })
})
