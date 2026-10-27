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
        "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-line",
        disabled && "opacity-40"
      )}
    >
      {/* Knob: off = x:2, on = x:18 (40px track - 20px knob - 2px inset) */}
      <motion.span
        animate={{ x: checked ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="absolute left-0 top-[2px] h-5 w-5 rounded-full bg-white shadow-sm"
      />
    </button>
  )
}
