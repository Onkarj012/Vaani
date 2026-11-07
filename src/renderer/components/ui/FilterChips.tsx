import { cn } from "@renderer/lib/utils"

// Renders selectable filters with optional result counts.
export default function FilterChips({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string
  options: { value: string; label: string; count?: number }[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-[13px] text-[12.5px] font-semibold text-muted",
            value === option.value && "border-transparent bg-ink text-bg"
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <small className="font-mono text-[10px] opacity-70">{option.count}</small>
          )}
        </button>
      ))}
    </div>
  )
}
