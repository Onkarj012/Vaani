import * as React from "react"
import { cn } from "@/lib/utils"

const tones = {
  white: "bg-bg",
  surface: "bg-surface",
  lav: "bg-chip-lav dark:bg-surface",
  sky: "bg-chip-sky dark:bg-surface",
  mint: "bg-chip-mint dark:bg-surface",
  blush: "bg-chip-blush dark:bg-surface",
  peach: "bg-chip-peach dark:bg-surface",
  butter: "bg-chip-butter dark:bg-surface",
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
        "rounded-[20px] p-6 shadow-soft transition-all duration-200 ease-[cubic-bezier(0.44,0,0.56,1)]",
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
