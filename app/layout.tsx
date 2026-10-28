import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import localFont from 'next/font/local'
import { parseTheme } from '../src/theme-choice'
import './style.css'
import './vaporwave.css'
import './popart.css'

// Self-hosted, so the page never asks a third party for a font.
const sans = localFont({ src: './fonts/Geist-Variable.woff2', variable: '--font-sans', weight: '100 900', display: 'swap' })
// The vaporwave faces are declared but not preloaded: only a visitor who picks that theme ever downloads them.
const display = localFont({ src: './fonts/Orbitron-Variable.woff2', variable: '--font-display', weight: '400 900', display: 'swap', preload: false })
const mono = localFont({ src: './fonts/ShareTechMono-Regular.woff2', variable: '--font-mono', weight: '400', display: 'swap', preload: false })
// The pop art theme's heavy condensed display face, likewise only fetched by a visitor who chooses it.
const poster = localFont({ src: './fonts/Anton-Regular.ttf', variable: '--font-pop', weight: '400', display: 'swap', preload: false })

export const metadata = { title: 'Localfolio', description: 'Your personal EUR portfolio' }

// The saved theme is read on the server, so the first paint already wears it and nothing flashes.
export default async function Layout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).toString())
  return <html lang="en" data-theme={theme} className={`${sans.variable} ${display.variable} ${mono.variable} ${poster.variable}`}><body>{children}</body></html>
}
