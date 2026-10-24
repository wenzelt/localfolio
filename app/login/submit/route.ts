import { login } from '../../../src/web-auth'

export async function POST(request: Request) {
  return login(request, { password: process.env.APP_PASSWORD ?? '', secret: process.env.SESSION_SECRET ?? '' }, Date.now())
}
