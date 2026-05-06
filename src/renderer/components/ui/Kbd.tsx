import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-6 min-w-[24px] select-none items-center justify-center px-[6px]",
        "font-sans text-[11px] font-bold tracking-[0.04em]",
        "bg-[var(--bg-2)] text-[var(--text)] border-2 border-[var(--border)]",
        "rounded-none",
        className
      )}
      {...props}
    />
  )
}

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
