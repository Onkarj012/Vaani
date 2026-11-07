import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@renderer/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-card font-semibold text-ink whitespace-nowrap transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        primary: "border-transparent bg-ink text-bg hover:bg-ink/90",
        accent: "border-transparent bg-accent text-white hover:bg-accent-strong",
        ghost: "border-transparent bg-transparent text-muted hover:bg-surface hover:text-ink",
        danger: "border-transparent bg-transparent text-red-600 hover:bg-red-500/10",
        outline: "",
        soft: "border-transparent bg-surface",
        destructive: "border-transparent bg-red-600 text-white hover:bg-red-700",
        link: "rounded-none border-0 bg-transparent px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        md: "h-9 px-[15px] text-[13px]",
        sm: "h-[30px] px-3 text-xs",
        default: "h-9 px-[15px] text-[13px]",
        lg: "h-12 px-8 text-base",
        icon: "size-8 border-0 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

// Renders a button with shared variants and sizes.
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : "button"
    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={!asChild ? (type ?? "button") : undefined}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

// Renders a round icon button with optional danger styling.
export function IconButton({ variant = "default", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        variant === "danger" && "text-red-600 hover:bg-red-500/10 hover:text-red-700",
        className
      )}
      {...props}
    />
  )
}

export { Button, buttonVariants }
