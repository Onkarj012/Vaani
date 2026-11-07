import type { ReactNode } from "react"

// Renders a shared page heading with an optional action area.
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <header className="mb-6 flex min-h-[101px] items-end justify-between gap-5 @max-[720px]/main:min-h-0">
      <div>
        <div className="label-meta min-h-[14px] text-[10px] text-faint">{eyebrow || "\u00a0"}</div>
        <h1 className="text-display mt-1.5 text-[56px] text-ink @max-[720px]/main:text-[46px]">
          {title}
        </h1>
        <p className="mt-2.5 min-h-5 text-sm text-muted">{subtitle || "\u00a0"}</p>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </header>
  )
}
