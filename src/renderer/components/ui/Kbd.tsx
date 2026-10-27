import { cn } from "@renderer/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-7 min-w-[28px] select-none items-center justify-center px-2",
        "font-body text-[12px] font-semibold text-ink",
        "rounded-[7px] border border-line-strong bg-card shadow-[inset_0_-1.5px_0_var(--color-line-strong),0_1px_1px_rgba(0,0,0,0.04)]",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />
}

export { Kbd, KbdGroup }
