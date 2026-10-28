import { ArrowUp, Check, Pause } from "lucide-react"
import { cn } from "@renderer/lib/utils"

// Fixed bar heights so the illustration looks like speech without random numbers on every render.
const BARS = [6, 11, 17, 9, 20, 14, 7, 18, 12, 22, 10, 15, 8, 19, 13, 6, 16, 11, 21, 9, 14, 7]

export type CapsuleState = "rec" | "proc" | "done"

// Static copy of the locked overlay pill, used to show people what the real overlay looks like.
export function Capsule({ state = "rec", doneLabel = "Inserted", className }: { state?: CapsuleState; doneLabel?: string; className?: string }) {
  if (state === "proc") {
    return (
      <div className={cn("capsule proc", className)} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
      </div>
    )
  }
  if (state === "done") {
    return (
      <div className={cn("capsule done", className)} aria-hidden="true">
        <span className="capsule-disc"><Check size={13} strokeWidth={3} /></span>
        {doneLabel}
      </div>
    )
  }
  return (
    <div className={cn("capsule", className)} aria-hidden="true">
      <span className="capsule-btn"><Pause size={12} fill="currentColor" strokeWidth={0} /></span>
      <span className="capsule-wave">
        {BARS.map((h, i) => <i key={i} style={{ height: h, animationDelay: `-${(i * 0.13).toFixed(2)}s` }} />)}
      </span>
      <span className="capsule-btn send"><ArrowUp size={14} strokeWidth={2.4} /></span>
    </div>
  )
}
