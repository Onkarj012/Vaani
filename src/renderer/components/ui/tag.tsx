import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  lav:    "bg-accent/10 text-accent",
  sky:    "bg-accent/10 text-accent",
  mint:   "bg-accent/10 text-accent",
  blush:  "bg-accent/10 text-accent",
  peach:  "bg-accent/10 text-accent",
  butter: "bg-accent/10 text-accent",
  ink:    "bg-ink text-bg",
  surface:"bg-surface text-muted",
} as const

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones
}

export function Tag({ className, tone = "lav", ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
