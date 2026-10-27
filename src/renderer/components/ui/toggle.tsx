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
        "relative h-[22px] w-[38px] shrink-0 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] transition-colors duration-200",
        checked ? "bg-accent" : "bg-line-strong",
        disabled && "opacity-40"
      )}
    >
      {/* Knob: off = x:2, on = x:18 (38px track - 18px knob - 2px margin) */}
      <motion.span
        animate={{ x: checked ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
        className="absolute left-0 top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_2px_6px_-1px_rgba(0,0,0,0.15)]"
      />
    </button>
  )
}
