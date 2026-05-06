---
paths:
  - "src/main/**/*.ts"
---
# Main Process Rules

## Dictation Lifecycle
- Orchestrated in `src/main/dictation.ts`: recording → finalizing → transcribing → inject/save.
- Overlay/tray and hotkey state MUST stay in sync with dictation state transitions.

## Injection Strategy (`src/main/injection/`)
- `auto` mode prefers accessibility injection, clipboard fallback based on policy.
- Some targets are clipboard-only — do not force accessibility injection for them.
- Accessibility permission required for global hotkeys and robust text injection.

## Stores
- Settings and history are JSON stores in `~/.claude_vaani/` via `src/main/store/*`.

## Text Processing
- Cleanup rules: `src/main/text/cleanup.ts`
- Formatting rules: `src/main/formatting.ts`

## Audio Gotchas
- Very short clips or low-signal audio intentionally dropped by VAD thresholds (`minClipDuration`, `silenceThreshold`).