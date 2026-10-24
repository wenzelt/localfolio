import { buyDeps } from '../../../src/buy-deps'
import { searchSymbolsRoute } from '../../../src/buy-routes'

export const dynamic = 'force-dynamic'
export const GET = (request: Request) => searchSymbolsRoute(request, buyDeps())
