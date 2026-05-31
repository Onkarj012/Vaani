import { motion } from "framer-motion"
import { cn } from "@renderer/lib/utils"

export function Toggle({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? "Toggle"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-line",
        disabled && "opacity-40"
      )}
    >
      {/* Knob: off = left (inset-x-[2px]), on = right (inset-x-[2px] from right) */}
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 35 }}
        className={cn(
          "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm",
          checked ? "right-[3px]" : "left-[3px]"
        )}
      />
    </button>
  )
}
