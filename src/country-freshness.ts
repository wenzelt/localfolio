export function compositionFreshness(asOf: string | null | undefined, now: Date): 'current' | 'stale' | 'unknown' {
  if (!asOf) return 'unknown'
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const sourceDay = Date.parse(`${asOf}T00:00:00.000Z`)
  return (today - sourceDay) / 86_400_000 > 90 ? 'stale' : 'current'
}
