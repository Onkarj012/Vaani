import { useEffect, useId, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@renderer/lib/utils"

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
  const listboxId = useId()
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    // Capture phase, so Escape closes only this list and not a surrounding modal.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open])

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-3 rounded-[10px] border bg-card px-3.5 text-left text-[13.5px] text-ink shadow-soft transition-all focus:outline-none",
          open ? "border-accent/60 ring-4 ring-accent/10" : "border-line hover:border-line-strong"
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-faint" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
            <motion.div
              id={listboxId}
              role="listbox"
              initial={{ opacity: 0, y: dropUp ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: dropUp ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
              className={cn(
                "absolute left-0 right-0 z-30 max-h-64 overflow-y-auto rounded-xl border border-line bg-card/95 p-1 shadow-pop backdrop-blur-xl",
                dropUp ? "bottom-full mb-1.5 origin-bottom" : "top-full mt-1.5 origin-top"
              )}
            >
              {options.map((opt) => {
                const selected = value === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { onChange(opt.value); setOpen(false) }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface",
                      selected ? "font-medium text-ink" : "text-ink/80"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {selected && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
