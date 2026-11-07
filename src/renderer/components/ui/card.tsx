import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  white:  "bg-card",
  surface:"bg-surface",
  lav:    "bg-chip-lav",
  sky:    "bg-chip-sky",
  mint:   "bg-chip-mint",
  blush:  "bg-chip-blush",
  peach:  "bg-chip-peach",
  butter: "bg-chip-butter",
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
        "card rounded-[24px] p-6 transition-all duration-200",
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
