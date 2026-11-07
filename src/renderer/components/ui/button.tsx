import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@renderer/lib/utils"

const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "pri",
        accent: "bg-accent text-white border-transparent hover:bg-accent-strong",
        outline: "bg-card text-ink",
        ghost: "ghost",
        soft: "bg-surface text-ink",
        destructive: "danger",
        link: "text-accent underline-offset-4 hover:underline bg-transparent rounded-none px-0",
      },
      size: {
        default: "",
        sm: "sm",
        lg: "h-12 px-8 text-base",
        icon: "icb h-8 w-8 p-0 border-0",
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
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={!asChild ? (type ?? "button") : undefined}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
