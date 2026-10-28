import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  lav:    "bg-chip-lav text-on-pastel",
  sky:    "bg-chip-sky text-on-pastel",
  mint:   "bg-chip-mint text-on-pastel",
  blush:  "bg-chip-blush text-on-pastel",
  peach:  "bg-chip-peach text-on-pastel",
  butter: "bg-chip-butter text-on-pastel",
  accent: "bg-accent/10 text-accent",
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
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
