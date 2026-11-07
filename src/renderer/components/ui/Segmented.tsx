import type { ReactNode } from "react"
import { cn } from "@renderer/lib/utils"

export type SegmentOption = { value: string; label: ReactNode }

// Renders a compact single-choice control.
export function Segmented({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string
  options: SegmentOption[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div
      className={cn("inline-flex items-center gap-0.5 rounded-full bg-surface p-[3px]", className)}
      role="group"
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn(
            "rounded-full px-[13px] py-1.5 text-[12.5px] font-semibold transition-colors",
            value === option.value
              ? "bg-card text-ink shadow-[0_1px_3px_#0002]"
              : "text-muted hover:text-ink"
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
