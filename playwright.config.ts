import { defineConfig, devices } from '@playwright/test'
import { e2e, testDatabaseUrl } from './e2e/env'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  globalSetup: './e2e/seed.ts',
  use: { baseURL: `http://127.0.0.1:${e2e.port}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'node e2e/yahoo-stand-in.mjs', url: `http://127.0.0.1:${e2e.yahooPort}/v1/finance/search?q=x`, reuseExistingServer: false, env: { PORT: String(e2e.yahooPort) } },
    {
      command: `npx next dev -p ${e2e.port} -H 127.0.0.1`,
      url: `http://127.0.0.1:${e2e.port}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATABASE_URL: testDatabaseUrl(true), APP_PASSWORD: e2e.password, SESSION_SECRET: e2e.secret, YAHOO_BASE_URL: `http://127.0.0.1:${e2e.yahooPort}` },
    },
  ],
})
