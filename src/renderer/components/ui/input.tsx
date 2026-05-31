import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "soft" | "underline"
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "soft", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full text-sm text-ink placeholder:text-faint outline-none transition-all duration-200 ease-[cubic-bezier(0.44,0,0.56,1)]",
        variant === "soft" &&
          "rounded-2xl border border-line bg-surface px-4 py-3 focus:border-accent focus:bg-bg",
        variant === "underline" && "input-underline px-0 py-3",
        className
      )}
      {...props}
    />
  )
)
Input.displayName = "Input"

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-faint outline-none transition-all duration-200 focus:border-accent focus:bg-bg",
      className
    )}
    {...props}
  />
))
Textarea.displayName = "Textarea"
