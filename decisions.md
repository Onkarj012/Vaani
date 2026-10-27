# Vaani decisions

Log of project decisions, newest first. Agents add entries as decisions happen; Ledger dedupes and marks superseded entries.

Entry format:

## YYYY-MM-DD — decision in one line
- rejected: ...
- why: ... (or "not stated")
- source: T3 thread "<title>"
- status: active | superseded by <date — decision>

---

## 2026-10-27 — Premium UI pass: warm neutral canvas, Instrument Serif titles, inset content panel, accent setting wired to the Tailwind token
- rejected: keeping the pastel editorial look (Cabinet Grotesk 800 headings, pill buttons everywhere); a full component-library swap; adding new settings or features to the UI; animating the App usage donut (audio-level re-renders restart it mid-draw)
- why: the user asked for a UI that feels premium while keeping every feature and option. Same screens and controls, restyled through shared tokens and primitives (PageHeader, Checkbox, IconTile, grouped settings rows). Fontshare is dropped; fonts now come only from Google Fonts. The accent picker previously wrote `--accent`, which nothing read, so the app ignored it. Added macOS drag regions because the hiddenInset titlebar had none.
- source: Claude Code session "premium-ui-redesign"
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
