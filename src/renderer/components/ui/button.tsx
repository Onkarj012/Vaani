import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all duration-200 ease-[cubic-bezier(0.44,0,0.56,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-bg hover:opacity-90",
        accent: "bg-accent text-white hover:bg-accent-strong",
        outline: "border border-ink/80 bg-transparent text-ink hover:bg-ink hover:text-white",
        ghost: "bg-transparent text-muted hover:bg-surface hover:text-ink",
        soft: "bg-surface text-ink hover:bg-line",
        destructive: "bg-transparent border border-red-200 text-red-600 hover:bg-red-50",
        link: "text-accent underline-offset-4 hover:underline bg-transparent rounded-none px-0",
      },
      size: {
        default: "h-11 px-6 text-sm",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
