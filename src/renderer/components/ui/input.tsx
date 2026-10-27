import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "soft" | "underline"
}

const fieldBase =
  "w-full text-[13.5px] text-ink placeholder:text-faint outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"

const fieldSoft =
  "rounded-[10px] border border-line bg-card shadow-[inset_0_1px_1px_rgba(0,0,0,0.03)] hover:border-line-strong focus:border-accent/60 focus:ring-4 focus:ring-accent/10"

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "soft", ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        fieldBase,
        variant === "soft" && cn(fieldSoft, "h-10 px-3.5"),
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
    className={cn(fieldBase, fieldSoft, "resize-none px-3.5 py-2.5 leading-relaxed", className)}
    {...props}
  />
))
Textarea.displayName = "Textarea"
