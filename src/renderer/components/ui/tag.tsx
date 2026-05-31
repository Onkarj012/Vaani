import * as React from "react"
import { cn } from "@/lib/utils"

const tones = {
  lav: "bg-chip-lav text-accent-strong",
  sky: "bg-chip-sky text-[#2c7fb8]",
  mint: "bg-chip-mint text-[#5a8a2a]",
  blush: "bg-chip-blush text-[#b5559b]",
  peach: "bg-chip-peach text-[#c4684f]",
  butter: "bg-chip-butter text-[#9a7b1a]",
  ink: "bg-ink text-bg",
  surface: "bg-surface text-muted",
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
