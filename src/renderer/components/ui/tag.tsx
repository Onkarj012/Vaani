import * as React from "react"
import { cn } from "@renderer/lib/utils"

// Pastel tone names are kept for existing call sites; they all render in the accent.
const tones = {
  lav:     "bg-accent/10 text-accent ring-accent/15",
  sky:     "bg-accent/10 text-accent ring-accent/15",
  mint:    "bg-accent/10 text-accent ring-accent/15",
  blush:   "bg-accent/10 text-accent ring-accent/15",
  peach:   "bg-accent/10 text-accent ring-accent/15",
  butter:  "bg-accent/10 text-accent ring-accent/15",
  ink:     "bg-ink text-bg ring-transparent",
  surface: "bg-surface text-muted ring-line",
  success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400",
  danger:  "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400",
} as const

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones
}

export function Tag({ className, tone = "lav", ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[-0.005em] ring-1 ring-inset",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
