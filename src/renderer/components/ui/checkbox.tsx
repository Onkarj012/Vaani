import type { ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "@renderer/lib/utils"

// Labelled checkbox. The native input stays in the DOM for keyboard and screen-reader behavior.
export function Checkbox({
  checked,
  onChange,
  children,
  description,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <label className={cn("group flex cursor-pointer items-start gap-2.5 text-[13px] text-ink", className)}>
      <span className="relative mt-[1px] flex h-[18px] w-[18px] shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-card shadow-[inset_0_1px_1px_rgba(0,0,0,0.04)] transition-colors checked:border-accent checked:bg-accent group-hover:border-ink/30 checked:group-hover:border-accent"
        />
        <Check size={12} strokeWidth={3} className="pointer-events-none absolute left-[3px] top-[3px] text-white opacity-0 transition-opacity peer-checked:opacity-100" />
      </span>
      <span className="min-w-0">
        <span className="block leading-snug">{children}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </span>
    </label>
  )
}
