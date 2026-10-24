'use client'

import { useEffect } from 'react'
import type { PerformancePeriod } from './performance-period'
import { savePreferences } from './view-preferences'

// Remembers the preferences the server resolved for this page, so the next visit starts the same way.
export function PreferenceSync({ period, hidden }: { period: PerformancePeriod; hidden: boolean }) {
  useEffect(() => savePreferences({ period, hidden }, document, location.protocol), [period, hidden])
  return null
}
