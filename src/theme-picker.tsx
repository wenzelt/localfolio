'use client'

import { useEffect, useRef } from 'react'
import { THEMES } from './theme-choice'
import type { Theme } from './theme-choice'

// A disclosure around a plain form: it opens and submits without script, and the server answers with the new theme already applied.
// Script only adds the closing a menu is expected to have: Escape, a press elsewhere, or focus moving on.
export function ThemePicker({ theme }: { theme: Theme }) {
  const picker = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: Event) => {
      const element = picker.current
      if (element?.open && !element.contains(event.target as Node)) element.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      const element = picker.current
      if (event.key !== 'Escape' || !element?.open) return
      element.open = false
      element.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  return <details ref={picker} className="theme-picker">
    <summary aria-label="Theme">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
      <span>Theme</span>
    </summary>
    <form action="/theme" method="post">
      {THEMES.map((choice) => <button key={choice.id} type="submit" name="theme" value={choice.id} aria-current={choice.id === theme ? 'true' : undefined}>
        <span className="swatch" data-swatch={choice.id} aria-hidden="true" />
        <span><strong>{choice.name}</strong><small>{choice.note}</small></span>
      </button>)}
    </form>
  </details>
}
