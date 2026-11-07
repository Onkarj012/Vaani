import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  lav: "bg-lav",
  sky: "bg-sky",
  mint: "bg-mint",
  blush: "bg-blush",
  peach: "bg-peach",
  butter: "bg-butter",
  ink: "bg-ink text-bg",
  surface: "bg-surface text-muted",
} as const

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones
}

// Renders a compact label in a semantic tone.
export function Tag({ className, tone = "lav", ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 text-[11px] font-semibold text-ink",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
