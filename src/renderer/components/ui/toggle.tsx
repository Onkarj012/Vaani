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
      {/* Knob: off = x:2, on = x:23 (44px container - 18px knob - 3px margin) */}
      <motion.span
        animate={{ x: checked ? 23 : 2 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="absolute left-0 top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm"
      />
    </button>
  )
}
