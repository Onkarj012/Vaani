import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  onChange,
  options,
  dropUp = false,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  dropUp?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink transition-colors hover:border-ink/20 focus:border-accent focus:outline-none"
      >
        {current?.label ?? value}
        <ChevronDown size={15} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute left-0 right-0 z-30 max-h-56 overflow-y-auto rounded-2xl border border-line bg-bg p-1.5 shadow-card",
              dropUp ? "bottom-full mb-2" : "top-full mt-2"
            )}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface",
                  value === opt.value ? "font-semibold text-accent" : "text-ink"
                )}
              >
                {opt.label}
                {value === opt.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
