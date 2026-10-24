import { buyDeps } from '../../../../src/buy-deps'
import { quoteSymbolRoute } from '../../../../src/buy-routes'

export const dynamic = 'force-dynamic'
export const GET = (request: Request) => quoteSymbolRoute(request, buyDeps())
