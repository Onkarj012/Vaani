import type { CSSProperties } from 'react'

// Draws the small dictation capsule used in the sidebar.
export default function MiniCapsule({ state, bars = [] }: { state: 'rec' | 'proc' | 'done'; bars?: number[] }) {
  if (state === 'proc') return <span className="cap proc" aria-label="Cleaning up"><i/><i/><i/><i/><i/></span>
  if (state === 'done') return <span className="cap done">✓ <span>Inserted</span></span>
  const levels = bars.length ? bars : [6, 10, 17, 12, 20, 11, 7, 15, 9]
  return <span className="cap"><span className="dt"/><span className="wv" aria-hidden="true">{levels.map((height, index) => <i key={index} style={{ '--h': `${Math.max(3, Math.min(22, height))}px`, '--d': `${index * -0.08}s` } as CSSProperties}/>)}</span></span>
}
