// YAHOO_BASE_URL exists so browser tests can point the app at a local stand-in for Yahoo; it is unset in normal use.
export const buyDeps = () => ({ secret: process.env.SESSION_SECRET ?? '', now: Date.now(), yahooBase: process.env.YAHOO_BASE_URL || undefined })
