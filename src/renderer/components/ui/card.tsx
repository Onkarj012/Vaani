import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  white:  "bg-card",
  surface:"bg-surface",
  lav:    "pastel-scope bg-chip-lav",
  sky:    "pastel-scope bg-chip-sky",
  mint:   "pastel-scope bg-chip-mint",
  blush:  "pastel-scope bg-chip-blush",
  peach:  "pastel-scope bg-chip-peach",
  butter: "pastel-scope bg-chip-butter",
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
        "rounded-card p-6 transition-all duration-200",
        tones[tone],
        bordered && "border border-line",
        hover && "hover:-translate-y-0.5 hover:shadow-card",
        className
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

export { Card }
