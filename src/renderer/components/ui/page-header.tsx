import type { ReactNode } from "react"
import { motion } from "framer-motion"
import { cn } from "@renderer/lib/utils"

export const pageContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

export const pageItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.32, 0.72, 0, 1] as const } },
}

// Shared page title block: mono eyebrow, serif title, short description, right-aligned actions.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <motion.header
      variants={pageItem}
      className={cn("flex flex-col justify-between gap-5 sm:flex-row sm:items-end", className)}
    >
      <div className="min-w-0">
        <p className="label-meta mb-3 flex items-center gap-2 text-[10.5px] text-faint">
          <span className="h-1 w-1 rounded-full bg-accent" />
          {eyebrow}
        </p>
        <h1 className="type-display text-[44px] text-ink">{title}</h1>
        {description && <p className="mt-2.5 max-w-xl text-[14px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </motion.header>
  )
}
