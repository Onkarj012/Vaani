# Vaani — Release Readiness Roadmap

_Status assessment date: 2026-07-20 · Current version: v1.1.3_

## Where the project stands

**Healthy:**

- v1.1.3 released 2026-07-07; the last five tagged releases (v1.0.7 → v1.1.3) all built green in CI.
- Unit tests: **267/267 passing** across 32 files (`bun run test`). Typecheck clean (`bun run typecheck`).
- **Zero open GitHub issues**, no TODO/FIXME debt in `src/`.
- Keychain-backed API key storage is implemented (`MacOSKeychainCredentialBackend` in `src/main/store/credentials.ts`).
- Multi-provider STT/LLM, offline whisper.cpp mode, auto-updater, and injection strategies are all in place and covered by tests.
- Steady bug-fix cadence: audit-driven fix PRs (#11, #12–#15) landed over the last two months.

**Not ready for public promotion yet.** The blockers below are ordered by impact on a first-time user downloading the app today.

---

## P0 — Launch blockers (do before any advertising)

### 1. Ship signed + notarized builds from CI
`forge.config.ts` conditionally enables `osxSign`/`osxNotarize` from `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`, but `.github/workflows/release.yml` never injects those secrets — every released DMG is **unsigned**. New users hit _“Vaani is damaged and can’t be opened”_ and must run `xattr -cr`, which kills conversion and looks untrustworthy.

- [ ] Enroll in the Apple Developer Program (Developer ID Application certificate).
- [ ] Add `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` as repo secrets and pass them as `env` on the *Make distributables* step in `release.yml`.
- [ ] Import the signing certificate into the CI keychain (e.g. `apple-actions/import-codesign-certs`).
- [ ] Verify the produced DMG: `spctl -a -vv Vaani.app` and `stapler validate`.
- [ ] Confirm auto-update works on the signed build — Squirrel.Mac requires a valid code signature, so the updater has likely never been exercised end-to-end on user machines.

### 2. Close out the "stale state after ~16 h" limitation
README still says _“root cause investigation ongoing”_ (watchdog mitigation shipped in v1.0.4). Advertising an app documented to become unresponsive daily is risky.

- [ ] Run a soak test (24 h+) on a packaged build; capture dictation traces/logs at the failure point.
- [ ] Root-cause and fix, or confirm the watchdog fully auto-recovers with no user-visible impact.
- [ ] Update the Known Limitations section accordingly.

### 3. Confirm the capsule overlay fix and retire the limitation
Retry logic landed in v1.0.4 and the `show()` fast-path fix in v1.0.7; capsule UI fixes continued through v1.1.3. Verify the intermittent non-appearance is actually gone across displays/Spaces/full-screen apps, then remove it from Known Limitations.

### 4. Refresh the README (it is the marketing page)
The README currently **understates the product** and will be the first thing prospective users read:

- [ ] Remove “API keys are stored in plain JSON on disk. Keychain integration is planned for v1.1” — Keychain storage is shipped.
- [ ] Update the Roadmap section (Keychain done; reflect real v1.2 plans).
- [ ] Once P0.1 lands, delete the `xattr -cr` workaround section — replace with a plain “download and open” install flow.
- [ ] Re-verify every Known Limitation is still true; delete the fixed ones.
- [ ] Add screenshots / a short demo GIF of the capsule + dictation flow.

---

## P1 — Stability hardening (first week after users arrive)

### 5. Add CI on pull requests and pushes
`release.yml` runs only on tags, so tests/typecheck run at release time only. Add a `ci.yml` (push + PR to `main`) running `bun install`, `bun run typecheck`, `bun run test`, and `bun run build:native` on `macos-latest`. This is what keeps quality steady once outside contributors and faster iteration arrive.

### 6. Support & feedback channels
- [ ] Add GitHub issue templates (bug report with macOS version / app version / provider, feature request).
- [ ] Add an in-app “Export logs” action (redacting keys/transcripts) so bug reports are actionable — there is no telemetry by design, so user-supplied logs are the only diagnostic signal.
- [ ] Add a `SUPPORT.md` / FAQ covering permissions (Accessibility, Microphone), provider key setup, and offline mode.

### 7. Developer-docs hygiene
- [ ] `CLAUDE.md` says `bun test`, which invokes Bun’s built-in runner (80 spurious failures) instead of Vitest — change to `bun run test`.
- [ ] `CLAUDE.md` references `graphify-out/` (GRAPH_REPORT.md, graph.json) which does not exist in the repo — remove or regenerate.

---

## P2 — Growth & distribution (after launch is stable)

### 8. Broader install surface
- [ ] Intel/universal builds — README claims “Apple Silicon or Intel” but releases ship `arm64` DMGs only; either build universal binaries or scope the claim to Apple Silicon.
- [ ] Homebrew cask (`brew install --cask vaani`) — meaningful discovery channel for the target audience.

### 9. Marketing assets
- [ ] Landing page (or a polished GitHub Pages site) with demo video, feature grid, and direct download.
- [ ] 30–60 s demo video showing hotkey → speak → text appears.
- [ ] Product Hunt / HN launch post once P0 items are done.

### 10. Post-launch product work (from existing v1.1+ roadmap)
- Smarter offline/online provider switching.
- Per-app profiles polish (language, provider, auto-submit).
- Optional opt-in crash reporting (privacy-preserving) to catch issues at scale.

---

## Suggested sequence

| Milestone | Contents | Gate to next step |
|---|---|---|
| **v1.2.0** | Signed + notarized CI builds, README refresh, PR CI workflow | `spctl` verified DMG, auto-update tested |
| **v1.2.1** | Stale-state root cause fix, capsule verification, log export | 24 h soak test clean |
| **Launch** | Landing page, demo video, Homebrew cask, announcement | — |

The codebase itself is in good shape — tested, typechecked, actively maintained, no open bugs. The gap is **distribution trust** (unsigned builds) and **two documented reliability caveats**. Close those and the project is safe to put in front of new users.
