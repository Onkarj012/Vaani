import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  white: "bg-card",
  surface: "bg-surface",
  lav: "bg-lav",
  sky: "bg-sky",
  mint: "bg-mint",
  blush: "bg-blush",
  peach: "bg-peach",
  butter: "bg-butter",
} as const

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof tones
  bordered?: boolean
  hover?: boolean
}

// Renders a rounded card with an optional pastel tone and hover lift.
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone = "white", bordered = true, hover = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[24px] p-6 transition-all duration-200",
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
