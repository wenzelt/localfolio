import { PERIODS } from './dashboard-view'
import type { PerformancePeriod } from './performance-period'

export type ViewPreferences = { period: PerformancePeriod; hidden: boolean }

const PERIOD_COOKIE = 'view_period'
const HIDE_COOKIE = 'view_hide'
const ONE_YEAR = 31536000

// 1D is retired; a stale link or cookie holding it falls back to the default.
const period = (value: string | undefined) => PERIODS.find((p) => p.value === value && p.value !== '1D')?.value
const hide = (value: string | undefined) => (value === '1' ? true : value === '0' ? false : undefined)

function cookieValue(header: string | null, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

// An explicit URL value wins over the saved cookie, which wins over the default. An explicit period that is
// invalid or retired (old period=1D links) means MAX, never the cookie; an invalid hide value is ignored.
export function resolveViewPreferences(query: { period?: string; hide?: string }, cookies: string | null): ViewPreferences {
  return {
    period: (query.period === undefined ? period(cookieValue(cookies, PERIOD_COOKIE)) : period(query.period)) ?? 'MAX',
    hidden: hide(query.hide) ?? hide(cookieValue(cookies, HIDE_COOKIE)) ?? false,
  }
}

export function preferenceCookies(preferences: Partial<ViewPreferences>, secure: boolean): string[] {
  const attributes = `Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
  return [
    ...(preferences.period === undefined ? [] : [`${PERIOD_COOKIE}=${preferences.period}; ${attributes}`]),
    ...(preferences.hidden === undefined ? [] : [`${HIDE_COOKIE}=${preferences.hidden ? 1 : 0}; ${attributes}`]),
  ]
}

// The preferences are not secrets, so they are plain cookies written in the browser; no extra route is needed.
export function savePreferences(preferences: Partial<ViewPreferences>, page: { cookie: string }, protocol: string) {
  for (const cookie of preferenceCookies(preferences, protocol === 'https:')) page.cookie = cookie
}
