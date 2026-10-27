import * as React from "react"
import { cn } from "@renderer/lib/utils"

const tones = {
  white:  "bg-card",
  surface:"bg-surface",
  lav:    "bg-chip-lav text-on-pastel",
  sky:    "bg-chip-sky text-on-pastel",
  mint:   "bg-chip-mint text-on-pastel",
  blush:  "bg-chip-blush text-on-pastel",
  peach:  "bg-chip-peach text-on-pastel",
  butter: "bg-chip-butter text-on-pastel",
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
