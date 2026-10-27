import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@renderer/lib/utils"

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium tracking-[-0.005em] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.16),0_4px_12px_-4px_rgba(0,0,0,0.25)] hover:bg-ink/90",
        accent: "accent-sheen text-white hover:brightness-[1.06]",
        outline: "border border-line-strong bg-card text-ink shadow-soft hover:border-ink/25 hover:bg-surface",
        ghost: "bg-transparent text-muted hover:bg-surface hover:text-ink",
        soft: "border border-line bg-card text-ink shadow-soft hover:border-line-strong hover:bg-surface",
        destructive: "border border-red-500/20 bg-red-500/[0.04] text-red-600 hover:border-red-500/35 hover:bg-red-500/10 dark:text-red-400",
        link: "text-accent underline-offset-4 hover:underline bg-transparent rounded-none px-0",
      },
      size: {
        default: "h-9 px-4 text-[13px]",
        sm: "h-8 px-3 text-[12.5px] [&_svg]:size-3.5",
        lg: "h-11 px-6 text-[14px]",
        icon: "h-9 w-9",
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
