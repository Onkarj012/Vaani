# Vaani decisions

Log of project decisions, newest first. Agents add entries as decisions happen; Ledger dedupes and marks superseded entries.

Entry format:

## YYYY-MM-DD — decision in one line
- rejected: ...
- why: ... (or "not stated")
- source: T3 thread "<title>"
- status: active | superseded by <date — decision>

---

## 2026-10-27 — Both recorder waveforms use a fixed -54 to -6 dB amplitude range
- rejected: per-chunk peak normalization and unrelated capsule layout changes
- why: quiet audio must remain visibly quieter than loud audio; preserve the approved loudness direction without expanding the overnight fix
- source: T3 thread "Overnight Backlog and Feature Builds", approved overlay decision in root decisions.md
- status: active

## 2026-10-24 — Track cleanup regressions with an offline comparison of saved baseline and candidate reports
- rejected: a new evaluation framework, scheduled paid runs, automatic baseline replacement, and folding production cleanup fixes into this PR
- why: the user wants regressions measured during ongoing quality work without turning every change into a long testing campaign. Reuse #43's JSON, compare each clip, and keep model calls separate. Require a declared experiment for recorded configuration/model differences; label legacy configuration gaps instead of claiming verified comparability. Metric changes do not establish meaning preservation.
- source: T3 thread "ec4341f0-203a-4e39-ba47-1945bd812c01"
- status: active

## 2026-10-22 — AGENTS.md is the single agent instruction file; CLAUDE.md imports it with `@AGENTS.md`
- rejected: CLAUDE.md as a symlink; keeping two copies; a minimal merge that kept the old structure; keeping the Context Rules section
- why: the two files had drifted (`bun test` vs `bun run test`, Dock rule and decisions log only in AGENTS.md). An import line leaves room for Claude-only lines. Context Rules repeated default agent behavior, and its "delegate 3+ files" line overrode the global "work alone" default.
- source: T3 thread "AGENTS.md / CLAUDE.md merge"
- status: active
