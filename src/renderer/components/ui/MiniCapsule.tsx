import type { CSSProperties } from "react"

// Draws the small dictation capsule used in the sidebar.
export default function MiniCapsule({
  state,
  bars = [],
}: {
  state: "rec" | "proc" | "done"
  bars?: number[]
}) {
  if (state === "proc") {
    return (
      <span
        className="inline-flex h-9 items-center gap-[5px] rounded-full border border-white/10 bg-[#121214]/[.97] px-4 text-[#f3f3f5]"
        aria-label="Cleaning up"
      >
        {Array.from({ length: 5 }, (_, index) => (
          <i
            key={index}
            className="size-[5px] rounded-full bg-accent opacity-30 animate-[vaani-processing-dot_1.4s_infinite]"
            style={{ animationDelay: `${index * 0.18}s` }}
          />
        ))}
      </span>
    )
  }

  if (state === "done") {
    return (
      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[#121214]/[.97] px-3.5 text-[11.5px] font-semibold text-emerald-400">
        ✓ <span>Inserted</span>
      </span>
    )
  }

  const levels = bars.length ? bars : [6, 10, 17, 12, 20, 11, 7, 15, 9]
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[#121214]/[.97] px-3.5 text-[11.5px] font-semibold text-[#f3f3f5]">
      <span className="size-2 rounded-full bg-accent" />
      <span className="flex h-[22px] items-center gap-[2.5px]" aria-hidden="true">
        {levels.map((height, index) => (
          <i
            key={index}
            className="w-[2.5px] origin-center rounded-sm bg-white/90 animate-[vaani-capsule-bar_.9s_ease-in-out_infinite_alternate]"
            style={{
              height: `${Math.max(3, Math.min(22, height))}px`,
              animationDelay: `${index * -0.08}s`,
            } as CSSProperties}
          />
        ))}
      </span>
    </span>
  )
}
