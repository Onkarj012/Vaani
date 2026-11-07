import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  lav: "bg-lav text-[#1d1d1d]",
  sky: "bg-sky text-[#1d1d1d]",
  mint: "bg-mint text-[#1d1d1d]",
  blush: "bg-blush text-[#1d1d1d]",
  peach: "bg-peach text-[#1d1d1d]",
  butter: "bg-butter text-[#1d1d1d]",
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
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-1 text-[11px] font-semibold",
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
