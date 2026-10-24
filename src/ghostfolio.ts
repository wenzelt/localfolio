type Currency = 'EUR' | 'USD'
type Account = {
  id: string; name: string; currency: Currency; balance: number
  balances: { date: string; value: number }[]
  comment: string | null; isExcluded: boolean; platformId: null
}
type Activity = {
  accountId: string; type: 'BUY' | 'SELL'; symbol: string; dataSource: 'YAHOO'
  currency: Currency; quantity: number; unitPrice: number; fee: number
  date: string; comment: string | null; tags: string[]
}
export type GhostfolioExport = {
  meta: { version: '0.0.1'; date: string }
  accounts: Account[]
  assetProfiles: []
  platforms: []
  tags: { id: string; name: string }[]
  activities: Activity[]
  user: { settings: { currency: 'EUR'; performanceCalculationType: 'ROAI' } }
}

export function parseGhostfolioJson(input: string): GhostfolioExport {
  let decoded: unknown
  try {
    decoded = JSON.parse(input)
  } catch {
    throw new Error('Invalid Ghostfolio JSON')
  }
  return parseGhostfolioExport(decoded)
}

export function parseGhostfolioExport(input: unknown): GhostfolioExport {
  const root = object(input, 'export')
  const meta = object(root.meta, 'meta')
  oneOf(meta.version, ['0.0.1'], 'meta.version')
  timestamp(meta.date, 'meta.date')
  for (const key of ['assetProfiles', 'platforms']) {
    if (array(root[key], key).length !== 0) fail(key, 'only empty collections are supported')
  }
  const accountIds = new Set<string>()
  array(root.accounts, 'accounts').forEach((value, index) => {
    const path = `accounts[${index}]`
    const account = object(value, path)
    unique(account.id, accountIds, `${path}.id`)
    text(account.name, `${path}.name`)
    oneOf(account.currency, ['EUR', 'USD'], `${path}.currency`)
    numeric(account.balance, `${path}.balance`)
    nullableText(account.comment, `${path}.comment`)
    if (typeof account.isExcluded !== 'boolean') fail(`${path}.isExcluded`, 'expected boolean')
    if (account.platformId !== null) fail(`${path}.platformId`, 'platform links are unsupported')
    array(account.balances, `${path}.balances`).forEach((item, balanceIndex) => {
      const balancePath = `${path}.balances[${balanceIndex}]`
      const balance = object(item, balancePath)
      timestamp(balance.date, `${balancePath}.date`)
      numeric(balance.value, `${balancePath}.value`)
    })
  })
  const tagIds = new Set<string>()
  array(root.tags, 'tags').forEach((value, index) => {
    const path = `tags[${index}]`
    const tag = object(value, path)
    unique(tag.id, tagIds, `${path}.id`)
    text(tag.name, `${path}.name`)
  })
  array(root.activities, 'activities').forEach((value, index) => {
    const path = `activities[${index}]`
    const activity = object(value, path)
    reference(activity.accountId, accountIds, `${path}.accountId`)
    oneOf(activity.type, ['BUY', 'SELL'], `${path}.type`)
    oneOf(activity.currency, ['EUR', 'USD'], `${path}.currency`)
    oneOf(activity.dataSource, ['YAHOO'], `${path}.dataSource`)
    text(activity.symbol, `${path}.symbol`)
    numeric(activity.quantity, `${path}.quantity`, true)
    for (const field of ['unitPrice', 'fee']) {
      numeric(activity[field], `${path}.${field}`)
      if ((activity[field] as number) < 0) fail(`${path}.${field}`, 'must be nonnegative')
    }
    timestamp(activity.date, `${path}.date`)
    nullableText(activity.comment, `${path}.comment`)
    array(activity.tags, `${path}.tags`).forEach((tag, tagIndex) => {
      reference(tag, tagIds, `${path}.tags[${tagIndex}]`)
    })
  })
  const user = object(root.user, 'user')
  const settings = object(user.settings, 'user.settings')
  oneOf(settings.currency, ['EUR'], 'user.settings.currency')
  oneOf(settings.performanceCalculationType, ['ROAI'], 'user.settings.performanceCalculationType')
  return structuredClone(input) as GhostfolioExport
}

function fail(path: string, reason: string): never {
  throw new Error(`${path}: ${reason}`)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value as Record<string, unknown>
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected array')
  return value
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'expected nonempty string')
}
function nullableText(value: unknown, path: string) {
  if (value !== null && typeof value !== 'string') fail(path, 'expected string or null')
}
function oneOf(value: unknown, allowed: string[], path: string) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path, 'unsupported value')
}
function numeric(value: unknown, path: string, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected finite number')
  if (positive && value <= 0) fail(path, 'must be positive')
}
function timestamp(value: unknown, path: string) {
  text(value, path)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(path, 'expected UTC ISO timestamp with milliseconds')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(path, 'invalid date')
}
function unique(value: unknown, ids: Set<string>, path: string) {
  text(value, path)
  if (ids.has(value)) fail(path, 'duplicate ID')
  ids.add(value)
}
function reference(value: unknown, ids: Set<string>, path: string) {
  text(value, path)
  if (!ids.has(value)) fail(path, 'unknown reference')
}
