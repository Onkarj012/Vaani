# Vaani decisions

Log of project decisions, newest first. Agents add entries as decisions happen; Ledger dedupes and marks superseded entries.

Entry format:

## YYYY-MM-DD — decision in one line
- rejected: ...
- why: ... (or "not stated")
- source: T3 thread "<title>"
- status: active | superseded by <date — decision>

---

## 2026-11-05 — Build the approved overlay (PR I) with one capsule window size, main-validated prompt edits, and a pausable main-process countdown
- rejected: resizing the window per state (pill, hands-free, status) as before; trusting the renderer to validate edited prompt values; a renderer-owned auto-dismiss timer; delaying the save until the Saved confirmation ends; keeping framer-motion and Tailwind utilities for the capsule; inventing new `DictationRejectionReason` values for the hotkey error
- why: one click-through 440 x 104 window means state changes never move or clip the capsule, so width can morph in place; the prompt grows to 384 x 320 for the edit card. Main is the trust boundary, so it re-checks edits (trigger format, taken triggers, manual dictionary rules) and replies with an error the card shows. The 8 s timer stays in main and pauses on the card's hover, focus, or Edit signal. The rule is saved on reply; only the window waits 1.7 s, so a new dictation cannot drop an accepted save. The approved page's CSS (keyframes, nth-child delays, ::after halo) ports as plain CSS more faithfully than utility classes. Enter submits only from an edit field; elsewhere it stays on the focused button (PR #53's rule). Edited dictionary rules are saved as manual so purging suggestions keeps them.
- source: owner brief "Implement Vaani 2.0 PR I"; design locked 2026-10-25 in docs/plans/vaani-2-0/vaani-overlay-approved.html
- status: active

## 2026-11-01 — Overlay save prompts dismiss with Escape and do not treat Enter as save
- rejected: mapping Enter to save while the prompt is focused; a global Escape shortcut that works outside the overlay window
- why: the prompt already takes keyboard focus, so Escape should return the user to what they were doing without saving. Enter stays on the focused button so a key meant for the previous app cannot create a snippet or dictionary rule.
- source: nightshift surprise "overlay prompt keyboard"
- status: active

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
