'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const REFRESH_SECONDS = 60

type Page = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

// Calls refresh every interval while the tab is visible, and straight away when it becomes visible again.
export function startPolling(refresh: () => void, seconds: number, page: Page = document) {
  const refreshIfVisible = () => { if (page.visibilityState === 'visible') refresh() }
  const timer = setInterval(refreshIfVisible, seconds * 1000)
  page.addEventListener('visibilitychange', refreshIfVisible)
  return () => {
    clearInterval(timer)
    page.removeEventListener('visibilitychange', refreshIfVisible)
  }
}

// A tick that arrives while the previous refresh is still pending is dropped, so slow requests never pile up.
export function refreshUnlessBusy(busy: boolean, startTransition: (work: () => void) => void, refresh: () => void) {
  if (!busy) startTransition(refresh)
}

export function updatedLabel(fetchedAt: string | null, now: Date) {
  if (fetchedAt === null) return ''
  const fetched = new Date(fetchedAt)
  return fetched.toDateString() === now.toDateString()
    ? fetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : fetched.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function LiveRefresh({ fetchedAt }: { fetchedAt: string | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const busy = useRef(false)
  busy.current = pending
  // The label depends on the viewer's time zone, so it is filled in after mount to match the server markup.
  const [label, setLabel] = useState('')
  useEffect(() => setLabel(updatedLabel(fetchedAt, new Date())), [fetchedAt])
  useEffect(() => startPolling(() => refreshUnlessBusy(busy.current, startTransition, () => router.refresh()), REFRESH_SECONDS), [router])
  return <span data-live-refresh="">{label && ` · Updated ${label}`}</span>
}
