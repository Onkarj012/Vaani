import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[22px] w-[44px] shrink-0 cursor-pointer items-center rounded-none border-2",
      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=unchecked]:border-[var(--border)] data-[state=unchecked]:bg-transparent",
      "data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)]",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[14px] w-[14px] rounded-none ring-0 transition-transform",
        "data-[state=unchecked]:translate-x-[2px] data-[state=unchecked]:bg-[var(--text-muted)]",
        "data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-white"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
