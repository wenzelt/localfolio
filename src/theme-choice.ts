import { sameOrigin } from './web-auth'

export const THEMES = [
  { id: 'ledger', name: 'Ledger', note: 'Calm ink, light or dark' },
  { id: 'vaporwave', name: 'Vaporwave', note: 'Neon outrun, always dark' },
  { id: 'popart', name: 'Pop Art', note: 'Stars and stripes, always bright' },
] as const

export type Theme = (typeof THEMES)[number]['id']

const COOKIE = 'theme'
const ONE_YEAR = 31536000

const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme.id === value)

export function parseTheme(cookies: string | null): Theme {
  const value = cookies?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  return isTheme(value) ? value : THEMES[0].id
}

// Back to the page the choice was made on, keeping its query; anything that is not a plain path on this origin means home.
function backTo(request: Request): string {
  const url = new URL(request.url)
  try {
    const page = new URL(request.headers.get('referer') ?? '')
    if (page.host === (request.headers.get('host') ?? url.host) && page.protocol === url.protocol && !page.pathname.startsWith('//')) return page.pathname + page.search
  } catch {}
  return '/'
}

// The theme is a preference, not a secret, but it is set on the server so the very first paint already wears it.
export async function chooseTheme(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 })
  const theme = (await request.formData()).get(COOKIE)
  if (!isTheme(theme)) return new Response('Unknown theme', { status: 400 })
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return new Response(null, { status: 303, headers: { location: backTo(request), 'set-cookie': `${COOKIE}=${theme}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure}` } })
}
