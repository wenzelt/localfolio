import type { ReactNode } from 'react'

// Artwork for the pop art parody theme. Everything here is decorative: hidden from assistive technology, never focusable,
// and drawn from the theme's tokens (ink outline, two flat golds), so one construction serves every size and the other themes never see it.
const line = { stroke: 'var(--pop-ink)', strokeWidth: 'var(--pop-outline)', strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' } as const

// The golden swoop: a misregistered shadow layer, the flat gold mass, one shaded forelock and two strand lines.
const mass = 'M14 104C4 62 38 22 92 17c42-4 84 9 104 41-16-8-32-7-42 0 18 5 30 18 36 40-30-16-66-18-92-10-26 8-54 20-84 16Z'
const Swoop = () => <>
  <path d={mass} transform="translate(5 5)" fill="var(--pop-gold-shadow)" {...line} />
  <path d={mass} fill="var(--pop-gold)" {...line} />
  <path d="M34 90c8-32 46-52 96-54-22 10-40 22-54 40-12 10-28 14-42 14Z" fill="var(--pop-gold-shadow)" {...line} />
  <path d="M60 74c22-22 52-30 90-28M96 66c24-10 46-12 72-4" fill="none" {...line} />
</>

export function HairSwoop({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 200 120" width="200" height="120" aria-hidden="true" focusable="false"><Swoop /></svg>
}

// A round sticker for a card corner.
export function HairSticker({ label }: { label: string }) {
  return <span className="hair-sticker" aria-hidden="true"><HairSwoop /><span>{label}</span></span>
}

// The swoop crowning a speech bubble.
export function HairCrest({ children }: { children: ReactNode }) {
  return <div className="hair-crest" aria-hidden="true"><HairSwoop /><span className="bubble">{children}</span></div>
}

// A restrained strip of the swoop, repeated.
export function HairPattern() {
  return <svg className="hair-pattern" width="100%" height="28" aria-hidden="true" focusable="false">
    <defs><pattern id="hair-pattern-tile" width="52" height="28" patternUnits="userSpaceOnUse"><svg viewBox="0 0 200 120" width="40" height="24" x="6" y="2" aria-hidden="true" focusable="false"><Swoop /></svg></pattern></defs>
    <rect width="100%" height="100%" fill="url(#hair-pattern-tile)" />
  </svg>
}

const RedCap = () => <svg className="hair-cap" viewBox="0 0 140 72" width="140" height="72" aria-hidden="true" focusable="false">
  <path d="M12 58C10 22 40 6 68 8c28 2 38 24 36 50Z" fill="var(--pop-red)" {...line} />
  <path d="M98 50c16-2 30 2 38 10-16 8-38 6-50-2Z" fill="var(--pop-red)" {...line} />
  <circle cx="68" cy="9" r="5" fill="var(--pop-red)" {...line} />
</svg>

const Star = ({ className }: { className: string }) => <svg className={`star ${className}`} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
  <path d="m12 2 3 7 7 .6-5.4 4.8L18.2 22 12 18l-6.2 4 1.6-7.6L2 9.6 9 9Z" fill="var(--pop-gold)" {...line} />
</svg>

// The page's one dominant hair composition: copy on the left (about 60%), the illustrated collage on the right.
export function HairBanner() {
  return <section className="pop-banner" aria-hidden="true">
    <div className="pop-banner-copy"><span className="pop-kicker">Parody edition</span><span className="pop-shout">Unprecedented <mark>volume</mark>.</span></div>
    <div className="pop-banner-art"><HairCrest>Big hair energy</HairCrest><RedCap /><Star className="star-a" /><Star className="star-b" /></div>
  </section>
}
