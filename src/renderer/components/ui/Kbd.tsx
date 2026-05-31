import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-7 min-w-[28px] select-none items-center justify-center px-2",
        "font-mono text-[12px] font-semibold text-ink",
        "rounded-lg border border-line bg-surface",
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
