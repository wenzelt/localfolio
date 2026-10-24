// Browser tests run their own app instance against a throwaway schema in `portfolio_test`.
// The real `portfolio` database and the real APP_PASSWORD are never used.
export const e2e = {
  port: 3100,
  yahooPort: 3101,
  password: 'e2e-only-password',
  secret: 'e2e-only-session-secret-0123456789abcdef',
  schema: 'e2e_dashboard',
}

export function testDatabaseUrl(inSchema: boolean) {
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = '/portfolio_test'
  if (inSchema) url.searchParams.set('search_path', e2e.schema)
  return url.toString()
}
