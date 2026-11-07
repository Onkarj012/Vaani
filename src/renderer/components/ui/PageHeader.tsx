import type { ReactNode } from 'react'
// Renders the shared page heading and action area.
export default function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow?: string; title: string; subtitle?: string; children?: ReactNode }) {
  return <header className="ph"><div className="ph-copy"><div className="meta eyebrow">{eyebrow || '\u00a0'}</div><h1>{title}</h1><p>{subtitle || '\u00a0'}</p></div><div className="ph-action">{children}</div></header>
}
