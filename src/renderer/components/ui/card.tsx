import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  white:  "bg-bg",
  surface:"bg-surface",
  lav:    "bg-accent/5",
  sky:    "bg-accent/5",
  mint:   "bg-accent/5",
  blush:  "bg-accent/5",
  peach:  "bg-accent/5",
  butter: "bg-accent/5",
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
        "rounded-[20px] p-6 shadow-soft transition-all duration-200",
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
