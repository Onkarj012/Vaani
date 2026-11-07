import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  lav:    "chip c-lav",
  sky:    "chip c-sky",
  mint:   "chip c-mint",
  blush:  "chip c-blush",
  peach:  "chip c-peach",
  butter: "chip c-butter",
  ink:    "chip bg-ink text-bg",
  surface:"chip bg-surface text-muted",
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
