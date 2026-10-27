import type { ReactNode } from "react"
import { cn } from "@renderer/lib/utils"

const sizes = {
  sm: "h-8 w-8 rounded-[9px]",
  md: "h-10 w-10 rounded-[11px]",
  lg: "h-14 w-14 rounded-2xl",
} as const

const tones = {
  accent:  "bg-accent/10 text-accent ring-accent/15",
  neutral: "bg-surface text-muted ring-line",
  success: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
} as const

// Rounded square holding an icon, used for list rows, cards and slide headers.
export function IconTile({
  children,
  size = "md",
  tone = "accent",
  className,
}: {
  children: ReactNode
  size?: keyof typeof sizes
  tone?: keyof typeof tones
  className?: string
}) {
  return (
    <div className={cn("flex shrink-0 items-center justify-center ring-1 ring-inset", sizes[size], tones[tone], className)}>
      {children}
    </div>
  )
}
