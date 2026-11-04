import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Dates follow TZ, so tests start from UTC whatever the shell sets; a test that needs a zone stubs it.
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/cli/**', 'src/test-support/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
