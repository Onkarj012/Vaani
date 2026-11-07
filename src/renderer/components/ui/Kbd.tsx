import { cn } from "@renderer/lib/utils"

// Renders a keyboard key label.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-grid h-6 min-w-6 select-none place-items-center rounded-[7px] border border-line bg-card px-1.5 font-body text-[11px] font-semibold text-ink shadow-[0_2px_0_var(--color-line)]",
        className
      )}
      {...props}
    />
  )
}

// Groups related keyboard key labels.
function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
