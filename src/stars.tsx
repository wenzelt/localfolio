import type { ReactNode } from 'react'

// Artwork for the pop art stars and stripes theme. Everything here is decorative: hidden from assistive technology, never focusable,
// and drawn from the theme's tokens (ink outline, two flat golds, flag red and blue), so one construction serves every size and the other themes never see it.
const line = { stroke: 'var(--pop-ink)', strokeWidth: 'var(--pop-outline)', strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' } as const

// A five-point star as polygon points: tips on the outer radius, notches on the inner one, first tip pointing up.
const star = (cx: number, cy: number, outer: number, inner: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 ? inner : outer
    const angle = (Math.PI * i) / 5 - Math.PI / 2
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`
  }).join(' ')

// The gold star: a misregistered shadow layer, the flat gold mass and one shaded arm.
const bigPoints = star(60, 62, 52, 22)
const arm = bigPoints.split(' ')
const Star = () => <>
  <polygon points={bigPoints} transform="translate(5 5)" fill="var(--pop-gold-shadow)" {...line} />
  <polygon points={bigPoints} fill="var(--pop-gold)" {...line} />
  <polygon points={`60,62 ${arm[5]} ${arm[6]} ${arm[7]}`} fill="var(--pop-gold-shadow)" stroke="none" />
</>

export function StarMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" focusable="false"><Star /></svg>
}

// A round sticker for a card corner.
export function StarSticker({ label }: { label: string }) {
  return <span className="star-sticker" aria-hidden="true"><StarMark /><span>{label}</span></span>
}

// The star crowning a speech bubble.
export function StarCrest({ children }: { children: ReactNode }) {
  return <div className="star-crest" aria-hidden="true"><StarMark /><span className="bubble">{children}</span></div>
}

// A restrained strip of the star, repeated.
export function StarPattern() {
  return <svg className="star-pattern" width="100%" height="28" aria-hidden="true" focusable="false">
    <defs><pattern id="star-pattern-tile" width="52" height="28" patternUnits="userSpaceOnUse"><svg viewBox="0 0 120 120" width="24" height="24" x="14" y="2" aria-hidden="true" focusable="false"><Star /></svg></pattern></defs>
    <rect width="100%" height="100%" fill="url(#star-pattern-tile)" />
  </svg>
}

// Thirteen stripes and a blue field of nine white stars. A plain flag, drawn flat like the rest of the theme.
const stripe = 100 / 13
const stripes = Array.from({ length: 13 }, (_, i) => ({ id: `stripe-${i}`, y: (i * stripe).toFixed(2), fill: i % 2 ? 'var(--surface)' : 'var(--pop-red)' }))
const field = Array.from({ length: 9 }, (_, i) => ({ id: `field-${i}`, points: star(12 + (i % 3) * 24, 12 + Math.floor(i / 3) * 15.4, 7, 3) }))
const Flag = () => <svg className="star-flag" viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">
  {stripes.map(({ id, y, fill }) => <rect key={id} x="0" y={y} width="160" height={(stripe + 0.3).toFixed(2)} fill={fill} />)}
  <rect x="0" y="0" width="72" height={(stripe * 7).toFixed(2)} fill="var(--pop-blue)" />
  {field.map(({ id, points }) => <polygon key={id} points={points} fill="var(--surface)" />)}
  <rect x="0" y="0" width="160" height="100" fill="none" {...line} />
</svg>

const Spark = ({ className }: { className: string }) => <svg className={`spark ${className}`} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
  <path d="m12 2 3 7 7 .6-5.4 4.8L18.2 22 12 18l-6.2 4 1.6-7.6L2 9.6 9 9Z" fill="var(--pop-gold)" {...line} />
</svg>

// The page's one dominant composition: copy on the left (about 60%), the illustrated collage on the right.
export function StarBanner() {
  return <section className="pop-banner" aria-hidden="true">
    <div className="pop-banner-copy"><span className="pop-kicker">Stars &amp; stripes edition</span><span className="pop-shout">Stars, stripes &amp; <mark>returns</mark>.</span></div>
    <div className="pop-banner-art"><StarCrest>Home of the brave</StarCrest><Flag /><Spark className="spark-a" /><Spark className="spark-b" /></div>
  </section>
}
