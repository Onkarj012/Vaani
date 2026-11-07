import type { CSSProperties, ReactElement } from "react"
import { cn } from "@renderer/lib/utils"

type AppStyle = {
  name: string
  bundleId: string
  background: string
  glyph: ReactElement
}

const APPS: AppStyle[] = [
  {
    name: "Slack",
    bundleId: "com.tinyspeck.slackmacgap",
    background: "#4A154B",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[62%] w-[62%]">
        <g strokeWidth={3.4} strokeLinecap="round">
          <path d="M9 4v7" stroke="#36C5F0" />
          <path d="M15 13v7" stroke="#2EB67D" />
          <path d="M4 15h7" stroke="#ECB22E" />
          <path d="M13 9h7" stroke="#E01E5A" />
        </g>
      </svg>
    ),
  },
  {
    name: "VS Code",
    bundleId: "com.microsoft.VSCode",
    background: "linear-gradient(160deg,#2aa3f0,#0065a9)",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[62%] w-[62%]">
        <path d="M17 3v18L6 12l11-9" />
        <path d="m6 8 4 4-4 4" />
      </svg>
    ),
  },
  {
    name: "Chrome",
    bundleId: "com.google.Chrome",
    background: "#fff",
    glyph: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[62%] w-[62%]">
        <circle cx="12" cy="12" r="11" fill="#DB4437" />
        <path d="M12 12 1.6 8A11 11 0 0 0 7 21.6z" fill="#0F9D58" />
        <path d="M12 12 7 21.6A11 11 0 0 0 23 12z" fill="#F4B400" />
        <circle cx="12" cy="12" r="5" fill="#fff" />
        <circle cx="12" cy="12" r="3.8" fill="#4285F4" />
      </svg>
    ),
  },
  {
    name: "Mail",
    bundleId: "com.apple.mail",
    background: "linear-gradient(180deg,#4fb2ff,#1474f0)",
    glyph: (
      <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true" className="h-[62%] w-[62%]">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="m2.5 6 9.5 7 9.5-7" fill="none" stroke="#1474f0" strokeWidth={1.6} />
      </svg>
    ),
  },
  {
    name: "Linear",
    bundleId: "com.linear",
    background: "linear-gradient(140deg,#7b84f0,#4b52c8)",
    glyph: (
      <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true" className="h-[62%] w-[62%]">
        <path d="M3.5 13.6 10.4 20.5A9 9 0 0 1 3.5 13.6zM3.2 10.5l10.3 10.3a9 9 0 0 0 2.2-.7L3.9 8.3a9 9 0 0 0-.7 2.2zM5 6.6l12.4 12.4a9 9 0 0 0 1.6-1.4L6.4 5A9 9 0 0 0 5 6.6zM8.2 4.2 19.8 15.8A9 9 0 0 0 8.2 4.2z" />
      </svg>
    ),
  },
  {
    name: "Notes",
    bundleId: "com.apple.Notes",
    background: "linear-gradient(180deg,#ffe066 0 28%,#fffdf4 28%)",
    glyph: (
      <svg viewBox="0 0 24 24" stroke="#c9c2a8" strokeWidth={1.4} aria-hidden="true" className="h-[62%] w-[62%]">
        <path d="M3 12h18M3 16h18M3 20h18" />
      </svg>
    ),
  },
]

const FALLBACK_BACKGROUNDS = ["#e3e3ff", "#ddeeff", "#e4f7cf", "#fbe1f6", "#ffe9e3", "#fff2bd"]

// Finds the known app by bundle id first, then by name.
function findApp(name: string | null, bundleId: string | null | undefined): AppStyle | undefined {
  const wanted = name?.trim().toLowerCase()
  return APPS.find((app) => app.bundleId === bundleId) ?? APPS.find((app) => app.name.toLowerCase() === wanted)
}

// Picks the same pastel for the same name every time.
function fallbackBackground(name: string): string {
  const hash = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)
  return FALLBACK_BACKGROUNDS[hash % FALLBACK_BACKGROUNDS.length] ?? "#e3e3ff"
}

// Rounded app tile: the app's own glyph when known, otherwise a pastel tile with its first letter.
export default function AppIcon({
  name,
  bundleId,
  size = 28,
}: {
  name: string | null
  bundleId?: string | null
  size?: number
}) {
  const app = findApp(name, bundleId)
  const label = name?.trim() ?? ""
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: size * 0.26,
    fontSize: size * 0.44,
    fontFamily: "-apple-system, system-ui, sans-serif",
    boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.12)",
    background: app ? app.background : fallbackBackground(label),
  }

  return (
    <span
      title={name ?? undefined}
      className={cn(
        "relative inline-grid flex-none place-items-center overflow-hidden font-extrabold",
        app ? "text-white" : "text-[#1d1d1d]"
      )}
      style={style}
    >
      {app ? app.glyph : (label.charAt(0).toUpperCase() || "?")}
    </span>
  )
}
