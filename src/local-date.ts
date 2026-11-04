// Today's date where the owner is: the calendar day in the IANA time zone named by TZ, or in UTC when TZ is unset.
// Containers run in UTC unless TZ is set, so the UTC clock alone would start the day hours early or late.
export function localDate(now: number): string {
  const timeZone = process.env.TZ || 'UTC'
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    throw new Error(`TZ must be an IANA time zone such as America/New_York, not ${timeZone}`)
  }
  const parts = Object.fromEntries(format.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
