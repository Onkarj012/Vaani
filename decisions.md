# Vaani decisions

Log of project decisions, newest first. Agents add entries as decisions happen; Ledger dedupes and marks superseded entries.

Entry format:

## YYYY-MM-DD — decision in one line
- rejected: ...
- why: ... (or "not stated")
- source: T3 thread "<title>"
- status: active | superseded by <date — decision>

---

## 2026-10-22 — AGENTS.md is the single agent instruction file; CLAUDE.md imports it with `@AGENTS.md`
- rejected: CLAUDE.md as a symlink; keeping two copies; a minimal merge that kept the old structure; keeping the Context Rules section
- why: the two files had drifted (`bun test` vs `bun run test`, Dock rule and decisions log only in AGENTS.md). An import line leaves room for Claude-only lines. Context Rules repeated default agent behavior, and its "delegate 3+ files" line overrode the global "work alone" default.
- source: T3 thread "AGENTS.md / CLAUDE.md merge"
- status: active
