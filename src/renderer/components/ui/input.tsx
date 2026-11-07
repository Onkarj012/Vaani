import * as React from "react"
import { cn } from "@renderer/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "soft" | "underline"
}

// Renders a text input in soft or underline style.
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "soft", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full text-sm text-ink placeholder:text-faint outline-none transition-all duration-200 ease-[cubic-bezier(0.44,0,0.56,1)]",
        variant === "soft" && "rounded-full bg-surface px-[15px] py-2 focus-visible:ring-1 focus-visible:ring-accent",
        variant === "underline" && "border-0 border-b-2 border-ink bg-transparent px-0 py-3 focus:border-accent",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"

// Renders a multiline text input.
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint outline-none focus:border-accent focus:bg-card",
      className
    )}
    {...props}
  />
))
Textarea.displayName = "Textarea"
