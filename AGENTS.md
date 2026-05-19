# Vaani

Premium macOS voice dictation app — Electron Forge + Vite + React + TypeScript, Groq Whisper transcription, native macOS integration.

## Commands
- `bun install` — install dependencies
- `bun run build:native` — build `vaani_native.node` (node-gyp)
- `bun run dev` — build native + start Electron Forge dev
- `bun run build` — package app locally
- `bun run make` — create platform artifacts under `out/make/`
- `bun run typecheck` — TypeScript check (no emit)
- `bun test` — Vitest unit tests (`tests/**/*.test.ts`)

## Architecture (read-only summary — do NOT re-read source files for this)
- `src/main/` — Electron main process (dictation, injection, tray, overlay, stores, native bridge)
- `src/renderer/` — React UI (settings, history, themes, Radix/Tailwind components)
- `src/preload/` — secure IPC bridge
- `src/shared/` — shared types, defaults, IPC channel definitions
- Native module: `build/Release/vaani_native.node` loaded at runtime

## Code Style
- TypeScript strict mode. Use `import type` where appropriate.
- Path aliases: `@main/*`, `@renderer/*`, `@shared/*`, `@preload/*` — no deep relative imports.
- No `any` unless unavoidable. No unused locals/params.
- Business logic in main-process services, not renderer components.
- Renderer components: presentation only. Reusable logic → hooks.
- Tailwind utility-first. Reuse primitives in `src/renderer/components/ui/`.

## Context Rules
- IMPORTANT: Minimize tool calls. Do NOT re-read files already in this session.
- Only read files when explicitly needed for the current task.
- Work from existing conversation context first.
- Batch all file changes into as few operations as possible.
- Delegate exploration of 3+ files to subagents.
- When compacting, always preserve: file paths being edited, current task description, unresolved errors.
- For Dock/window-activation bugs, compare the current branch against `main` before changing window lifecycle code. Avoid startup prewarm or hidden-window creation unless it is explicitly required and verified not to affect Dock visibility.

## Prohibitions
- NEVER remove the native build step from scripts — app depends on `vaani_native.node`.
- NEVER commit secrets (Groq API key). Keep keys out of source and docs.
- NEVER edit generated/build artifacts (`.vite/`, `build/`, `out/`, `dist/`, `coverage/`).
- Do NOT add new dependencies without asking first.

## Testing
- Logic changes in `src/main/*` or `src/shared/*` → run `bun test`
- Type-heavy refactors → run `bun run typecheck`
- Add/adjust unit tests in `tests/unit/` alongside behavior changes.

## Key References
- See @README.md for product behavior, permissions, user-facing workflows.
- See @package.json for canonical scripts.
- For architecture deep-dives, see @.claude/rules/

## Graphify Context
- This project has a graphify knowledge graph at `graphify-out/`.
- See `@graphify-out/GRAPH_REPORT.md` for architecture summary, hubs, and community clusters.
- See `@graphify-out/graph.json` for machine-readable dependency/call graph data.
- See `@graphify-out/graph.html` for interactive graph exploration.
- Before answering architecture questions, read GRAPH_REPORT.md for god nodes.
- After modifying code files, run `graphify update .` to keep the graph current (AST-only, no API cost).
