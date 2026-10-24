import postgres from 'postgres'
import { buyDeps } from '../../../src/buy-deps'
import { createBuy } from '../../../src/buy-routes'

export const dynamic = 'force-dynamic'
// The only connection in the web app that can write; the dashboard keeps its read-only one.
const sql = postgres(process.env.DATABASE_URL ?? '')
export const POST = (request: Request) => createBuy(request, { ...buyDeps(), sql })
