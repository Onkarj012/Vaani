import * as React from "react"
import { cn } from "@renderer/lib/utils"

// Pastel tone names are kept for existing call sites; they all render as a soft accent tint.
const tones = {
  white:   "bg-card",
  surface: "bg-surface",
  lav:     "bg-accent/[0.06] border-accent/15",
  sky:     "bg-accent/[0.06] border-accent/15",
  mint:    "bg-accent/[0.06] border-accent/15",
  blush:   "bg-accent/[0.06] border-accent/15",
  peach:   "bg-accent/[0.06] border-accent/15",
  butter:  "bg-accent/[0.06] border-accent/15",
  success: "bg-emerald-500/[0.06] border-emerald-500/20",
  warning: "bg-amber-500/[0.07] border-amber-500/25",
} as const

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof tones
  bordered?: boolean
  hover?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = "white", bordered = true, hover = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl p-6 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        bordered ? "border border-line" : "border border-transparent",
        tone === "white" && "shadow-soft",
        tones[tone],
        hover && "hover:-translate-y-px hover:border-line-strong hover:shadow-card",
        className
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

export { Card }
