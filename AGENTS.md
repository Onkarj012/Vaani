# Vaani

macOS voice dictation app. Electron Forge + Vite + React + TypeScript, native macOS addon, multi-provider transcription (Groq, OpenAI, Deepgram, local whisper.cpp) and LLM formatting.

## Commands
Scripts live in `package.json`; run them with `bun run <script>`.
- Tests: `bun run test` (Vitest). Plain `bun test` starts Bun's own runner and reports ~49 bogus failures.
- `dev`, `build`, `make`, `publish` all build `vaani_native.node` first. Keep that native build step in every script; the app fails to load without it.

## Worktrees
- Work that ends in a PR goes in its own git worktree off `main`. One-line fixes can go straight in the root checkout.
- The root checkout stays on `main`.

## Layout
- `src/main/` holds business logic as main-process services. `src/renderer/` is presentation only; reusable renderer logic goes in hooks.
- `src/preload/` is the IPC bridge; `src/shared/` holds types, defaults, and IPC channel names.
- Reuse UI primitives in `src/renderer/components/ui/`.

## Code style
- TypeScript strict. `import type` for type-only imports. Real types instead of `any`.
- Import across folders with path aliases (`@main/*`, `@renderer/*`, `@shared/*`, `@preload/*`).
- Tailwind utility classes.

## Area rules
Read before editing:
- `src/main/**` → `.claude/rules/main-process.md` (dictation lifecycle, services).
- `src/shared/ipc.ts`, `src/preload/**`, renderer IPC calls → `.claude/rules/ipc-compat.md`.
- Dock or window-activation bugs → diff the current branch against `main` before touching window lifecycle code. Create windows on demand; add startup prewarm or hidden windows only when required and verified to leave Dock visibility unchanged.

## Testing
- Logic change in `src/main/` or `src/shared/` → add or adjust a test in `tests/unit/`, then `bun run test`.
- Type-heavy refactor → `bun run typecheck`.

## Guardrails
- Ask before adding a dependency.
- Keep API keys out of source, docs, and commits.
- Edit source only; `.vite/`, `build/`, `out/`, `dist/`, `coverage/` are generated.

## Graphify
- Architecture questions → read `graphify-out/GRAPH_REPORT.md` first for hubs and clusters; `graphify-out/graph.json` has the call graph.
- After changing code files, run `graphify update .` (AST only, no API cost).

## Decisions log
When a choice between options changes what gets built or how (stack, architecture, scope cuts, naming, data model, a dropped approach), add it to the top of `decisions.md`. Include the date (IST), the decision in one line, what was rejected, why ("not stated" if no reason was given), the source thread, and a status. If it reverses an older entry, mark that entry superseded instead of deleting it. Ledger dedupes entries and marks superseded ones.

Product behavior, permissions, and release steps: `README.md`.
