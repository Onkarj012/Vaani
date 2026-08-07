# Plan 006: Make `feat/text-pipeline-phase3` shippable

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 279da30..HEAD -- src/main/ipc.ts src/main/dictation.ts src/main/transcription.ts src/renderer/components/SettingsModal.tsx src/renderer/context/vaani-ui.tsx tests/unit/transcriptionChain.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P0 (release blocker set)
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / release readiness
- **Planned at**: commit `279da30`, branch `feat/text-pipeline-phase3`, 2026-08-07

## Why this matters

The branch is 10 commits ahead of `main` (`1acddb9`) and carries the security audit,
silence-aware chunking, and Phase 3 text-pipeline work. It cannot ship as-is:

- A clean checkout of the committed tree **fails 2 tests** — CI would be red on the
  first push.
- Two committed data-loss bugs (API keys, dictionary metadata) affect real user
  state, not just internals.
- Long recordings — the headline capability of the chunking commit — can time out.
- The working tree holds 11 modified tracked files plus 5 untracked files, and
  tracked code imports untracked modules, so a partial commit breaks the build.

## Verification baseline (already established)

| Check | Result |
|---|---|
| Worktree `bun run test` | 360/360 pass |
| Worktree `bun run typecheck` | pass |
| Worktree `bun run build` (native + package) | pass |
| `git diff --check main` | clean |
| **Clean committed HEAD `bun run test`** | **2 failed, 342 passed** |
| Clean committed HEAD `bun run typecheck` | pass |

Reproduce the committed-tree gate with:

```bash
tmp=$(mktemp -d); git archive HEAD | tar -x -C "$tmp"
ln -s "$PWD/node_modules" "$tmp/node_modules"
bun run --cwd "$tmp" test && bun run --cwd "$tmp" typecheck
```

This snapshot check is the single most important gate in this plan: the worktree
passing tells us nothing about what a PR would run.

---

## Step 1 — Land the working tree atomically (P0, unblocks everything)

**Problem.** `src/main/dictation.ts:46-47` and `vite.main.config.ts:4` import
`@shared/buildIdentifier` and `@shared/insertionAcceptance`, both untracked. A
tracked-only commit (`git commit -am`) produces unresolved-module build failures.

**Current state.**

- Modified tracked: `CLAUDE.md`, `src/main/dictation.ts`,
  `src/main/dictationTraceSnapshot.ts`, `src/main/store/dictationTrace.ts`,
  `src/shared/types.ts`, `vite.main.config.ts`, 5 test files.
- Untracked: `src/shared/buildIdentifier.ts`, `src/shared/insertionAcceptance.ts`,
  `tests/unit/buildIdentifier.test.ts`, `tests/unit/insertionAcceptance.test.ts`,
  `scripts/ghostty-trial.mjs`.

**Actions.**

1. Split into two commits, each self-consistent:
   - **Commit A — test corrections only**: `tests/unit/transcriptionChain.test.ts`
     (3-attempt and 28s-chunk expectations). This alone makes the committed tree
     green and is the fix for Step 2.
   - **Commit B — build identifier + insertion acceptance**: the two `src/shared/`
     modules, their two tests, `src/main/dictation.ts`,
     `src/main/dictationTraceSnapshot.ts`, `src/main/store/dictationTrace.ts`,
     `src/shared/types.ts`, `vite.main.config.ts`, plus the remaining test edits.
2. Decide on `scripts/ghostty-trial.mjs`. It writes results to `.wayfinder/research/`,
   which commit `b4ab696` deliberately keeps out of the public repo. Either
   (a) retarget its `RESULTS_PATH` to a repo-visible or `/tmp` location and commit it
   as a documented manual harness, or (b) leave it untracked. Do not commit it with
   the `.wayfinder` path.
3. `CLAUDE.md` change is documentation — fold into Commit B.

**Verification.** After both commits, the snapshot check above must exit 0.

**STOP condition.** If splitting produces a commit whose snapshot check fails, do not
push; re-stage until each commit is independently green.

---

## Step 2 — Fix the committed test failures (P0)

**Problem.** The committed tree asserts behavior the committed implementation does
not have.

**Current state.**

```ts
// tests/unit/transcriptionChain.test.ts:220 (committed)
expect(groqTranscribe).toHaveBeenCalledTimes(2);
// tests/unit/transcriptionChain.test.ts:378 (committed)
).toEqual([30, 30, 30, 30, 30, 20]);
```

`buildTranscriptionAttempts` (`src/main/transcription.ts:298`) yields original clip +
retry clip + stronger-model attempt = 3 calls. `snapChunkEndToSilence`
(`src/main/transcription.ts:334`) snaps boundaries, producing 28s chunks for the
fixture.

**Actions.** The corrected expectations already exist uncommitted (3 calls, `[28,…]`,
renamed test titles). Land them via Commit A in Step 1.

**Decision required before accepting the numbers as correct**: confirm 3 STT calls per
suspicious single-provider transcript is intended. It triples cost and latency on the
worst-quality audio. If not intended, fix `buildTranscriptionAttempts` instead of the
test and keep the 2-call expectation.

**Verification.** `bun run test` green in the snapshot check.

---

## Step 3 — Stop API-key saves from deleting other providers' keys (P0, data loss)

**Problem.** Editing one provider's key silently deletes every other provider's key
from the keychain.

**Chain.**

```ts
// src/main/ipc.ts:303-321 — every provider is returned with key: ''
mapped = providerApiKeys.map(pk => ({ providerId: pk.providerId, key: '', hasKey: ... }))
```

```tsx
// src/renderer/components/SettingsModal.tsx:245-250 — resubmits the whole array
const next = existing >= 0 ? current.map(...) : [...current, { providerId, key }]
void updateSettings({ providerApiKeys: next })
```

```ts
// src/main/ipc.ts:444-450 — every entry is written, including the redacted ''
if (typeof pk.key === "string") await credentials.set(pk.providerId, pk.key);
```

```ts
// src/main/store/credentials.ts:84-92 — empty value means delete
if (!trimmed) { await this.delete(key); return; }
```

Result: save the OpenAI key → Groq, Deepgram, Anthropic keys are deleted.

**Actions (pick one; option A recommended).**

- **A — dedicated per-provider IPC mutation.** Add `SetProviderApiKey` /
  `ClearProviderApiKey` channels. Renderer stops round-tripping the key array
  entirely; `providerApiKeys` in settings becomes presence-only metadata. Clearing is
  then an explicit user action, never an inferred one.
- **B — sentinel for "unchanged".** Keep the array round-trip but have
  `buildRendererApiKeys` emit a sentinel (e.g. `key: null` / omitted) for stored keys,
  and treat only an explicit empty string submitted from a touched field as a delete.
  Cheaper, but leaves the fragile shape in place.

**Tests to add** in `tests/unit/ipcSecurity.test.ts` (or a new `providerKeys.test.ts`):

1. Three providers have keys; update only one → other two survive in the credentials
   store.
2. Explicit clear of one provider deletes exactly that one.
3. Renderer-facing settings never expose key material (`key: ''`, `hasKey` correct).

---

## Step 4 — Stop dictionary edits from destroying Phase 3 metadata (P0, data loss)

**Problem.** Every settings update that carries `customCorrections` rewrites each
entry to three fields.

```ts
// src/main/ipc.ts:288-301
return [{ spoken, written, source: "manual" }];
```

`CustomCorrection` (`src/shared/types.ts:210-220`) also has `enabled`,
`caseSensitive`, `wholeWord`, `fuzzy`, `hitCount`, `lastUsedAt`. All are dropped, and
`source: "auto-suggested"` is rewritten to `"manual"`.

Consequences, all in shipped code paths:

- `fuzzy` is read at `src/main/text/cleanup.ts:354` → fuzzy matching silently turns
  off after any dictionary edit.
- `enabled: false` is read at `src/main/text/cleanup.ts:379` → disabled rules
  silently re-enable.
- Provenance loss breaks "purge auto-suggested corrections".
- The renderer compounds it: `src/renderer/context/vaani-ui.tsx:230` also forces
  `source: "manual"` on edit of an existing rule.

**Actions.**

1. Rewrite `sanitizeManualCustomCorrections` to validate-and-preserve: keep every
   known optional field when present and well-typed; bound `hitCount`; validate
   `lastUsedAt` as ISO; preserve existing `source`, defaulting to `"manual"` only for
   entries that are new.
2. Rename it (e.g. `sanitizeCustomCorrections`) — it is no longer manual-only.
3. Fix `src/renderer/context/vaani-ui.tsx:230` to preserve `source` on update of an
   existing entry.

**Tests to add** in `tests/unit/ipcSecurity.test.ts`:

1. Round-trip a correction with `fuzzy`, `enabled: false`, `hitCount`, `lastUsedAt`,
   `source: "auto-suggested"` → all preserved.
2. Oversized/malformed fields still rejected (existing safety intact).
3. New manual entry without `source` still gets `source: "manual"`.

---

## Step 5 — Give chunked long recordings a workable timeout (P1)

**Problem.** Chunked transcription is sequential but the whole chain shares one 30s
deadline.

```ts
// src/main/dictation.ts:50
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
// src/main/transcription.ts:290-293 — sequential per-chunk awaits
for (const [index, chunk] of chunks.entries()) { results.push(await provider.transcribe(chunk, options)); }
```

A 3-minute dictation is ~7 chunks; a 10-minute one is ~22. Cumulative latency passes
30s routinely → the user sees "Transcription timed out" while in-flight requests keep
burning provider quota, uncancelled.

**Actions.**

1. Replace the fixed deadline with a budget scaled to work:
   `base + perChunk × chunkCount`, with an absolute ceiling. Chunk count is knowable
   before the call from `clip.durationSeconds` and `MAX_SINGLE_STT_CLIP_SECONDS`.
2. Prefer a per-attempt deadline inside `transcribePossiblyChunked` over one outer
   race, so a single wedged chunk fails fast instead of consuming the whole budget.
3. Pass an `AbortSignal` through `TranscriptionProvider.transcribe` so a timeout stops
   subsequent chunk requests. If providers can't take a signal without a wider
   refactor, at minimum add a `cancelled` check between chunk iterations — cheap, and
   it stops the quota bleed for remaining chunks.
4. Same treatment for the demo path at `src/main/dictation.ts:617`.

**Tests to add** in `tests/unit/transcriptionChain.test.ts` /
`tests/unit/dictation.test.ts`:

1. A long clip whose per-chunk latency sums past 30s completes successfully.
2. On timeout, no further chunk requests are issued.

---

## Step 6 — Make insertion verification compare against the baseline (P1, metric integrity)

**Problem.** Verification accepts any occurrence of the expected text, including text
that was already there.

```ts
// src/main/dictation.ts:1027 and the poll at :1075
if (currentValue.includes(expectedText)) return { readable: true, passed: true, ... };
```

The `baseline` parameter is only consulted later, via `extractInsertedFragment`. So
re-dictating the same sentence into a field that already contains it passes instantly
even if nothing was inserted — and that false pass feeds the 95% acceptance gate at
`src/shared/insertionAcceptance.ts:101-106`, which is the metric intended to decide
whether insertion is healthy enough to ship.

**Actions.**

1. Require a *new* occurrence: compare occurrence counts of `expectedText` in
   `baseline` vs `currentValue`, or verify the expected range at the insertion point.
2. When `baseline` is null (unreadable before injection), record a distinct
   `reason` and exclude that trace from acceptance eligibility rather than counting it
   as success.
3. Keep the polling loop (`src/main/dictation.ts:1063`) — the 50ms/2s poll is a real
   improvement over the old fixed 180ms sleep and should stay.

**Tests to add** in `tests/unit/insertionAcceptance.test.ts` /
`tests/unit/dictation.test.ts`:

1. Field already contains the expected sentence, injection inserts nothing →
   verification fails.
2. Field contains one copy, injection adds a second → passes.
3. Baseline unreadable → trace excluded from acceptance counts.

---

## Step 7 — Decide the Phase 3 UI surface (P2, scope decision — needed before "shipped")

**Problem.** Phase 3 features default off and have no UI to turn on.

- `fuzzy` defaults off (`src/main/text/cleanup.ts:354`), and the Dictionary form
  (`src/renderer/pages/Dictionary.tsx:92-107`) exposes only trigger and replacement.
- `Snippet.matchBareTrigger` and `Snippet.appProfileIds` (`src/shared/types.ts:222-227`)
  are consumed at `src/main/text/cleanup.ts:416,428` but never set by
  `addSnippet` (`src/renderer/context/vaani-ui.tsx:242-258`).

So the shipped behavior is reachable only by hand-editing `~/.vaani` settings JSON.

**Decision required — pick one and record it here:**

- **A — ship the UI**: add a fuzzy toggle to the Dictionary form and
  bare-trigger + app-scope controls to Snippets. Larger, but the features become real.
  Depends on Step 4 (without metadata preservation, a fuzzy toggle would not survive
  the next edit).
- **B — ship as engine-only**: land Phases 0–3 as pipeline infrastructure, and state
  in `CHANGELOG.md` that fuzzy matching and bare snippet triggers are not yet
  user-configurable. Defer the UI to a follow-up plan.

Either is defensible. What is not defensible is release notes implying these are
usable features while no UI exists.

---

## Step 8 — Chunk-overlap merge quality (P2, quality)

**Problem.** Overlap dedup only matches runs of ≥3 words.

```ts
// src/main/transcription.ts:405
for (let count = maxOverlap; count >= 3; count -= 1) {
```

With a 2-second overlap, a boundary landing on a 1–2 word span leaves a duplicated
phrase (`"hello world hello world"`) that the single-word duplicate cleanup won't
catch.

**Actions.** Either lower the floor to 1–2 words guarded against false positives on
common words, or align chunks on timestamps where the provider returns segment times.
Add tests for 1-word and 2-word boundary overlaps.

Lower priority than Steps 1–6: it degrades transcript quality at chunk seams, it does
not lose user data or fail the build.

---

## Step 9 — Release hygiene, then open the PR

1. `git diff --check main` — currently clean; keep it that way. (Trailing whitespace
   at `src/main/ipc.ts:387,395` and `references/design.md:3` exists in older commits
   relative to `initial-scaffold`; not worth a rewrite, but do not add more.)
2. `CHANGELOG.md` — add the entry covering: IPC validation and keychain hardening,
   silence-aware chunking + model escalation, dictionary-before-formatting ordering,
   fuzzy matching, bare snippet triggers, build identifier in traces.
3. `README.md` — the Known Limitations list still claims API keys are plain JSON with
   "Keychain integration planned for v1.1". Keychain landed on this branch
   (`src/main/store/credentials.ts`, commit `92965e5`). Update it.
4. Version bump in `package.json` (currently 1.1.3, matching tag `v1.1.3` on `main`).
5. Open the PR against `main`, not `initial-scaffold`. Confirm CI runs the committed
   tree and is green before requesting review.

---

## Sequencing

| Order | Step | Blocking? | Rationale |
|---|---|---|---|
| 1 | Step 1 (atomic commits) | yes | Nothing else is verifiable until the tree is committable |
| 2 | Step 2 (test failures) | yes | Red CI blocks the PR |
| 3 | Step 3 (API keys) | yes | User data loss |
| 4 | Step 4 (dictionary metadata) | yes | User data loss; blocks Step 7A |
| 5 | Step 5 (timeout) | yes | Headline feature is unreliable |
| 6 | Step 6 (acceptance metric) | yes | Ship-gate metric is unsound |
| 7 | Step 7 (UI decision) | decision | Determines release-note honesty |
| 8 | Step 8 (overlap merge) | no | Quality; can follow the release |
| 9 | Step 9 (hygiene + PR) | yes | Final gate |

Steps 3, 4, 5, 6 are independent of each other and can run in parallel once Step 1
lands.

## Verification gates (all must pass before the PR)

```bash
# 1. committed-tree snapshot — the gate that actually matters
tmp=$(mktemp -d); git archive HEAD | tar -x -C "$tmp"
ln -s "$PWD/node_modules" "$tmp/node_modules"
bun run --cwd "$tmp" test && bun run --cwd "$tmp" typecheck

# 2. worktree
bun run test && bun run typecheck

# 3. packaging (native module must build)
bun run build

# 4. whitespace
git diff --check main

# 5. no untracked file is imported by tracked code
git ls-files --others --exclude-standard
```

Manual checks that unit tests cannot cover:

- Configure two provider keys, edit one, restart the app → both keys still work.
- Add a dictionary rule with fuzzy enabled (via settings JSON until Step 7 lands),
  then edit an unrelated rule from the UI → fuzzy flag survives.
- Dictate 3+ minutes into TextEdit → full transcript inserted, no timeout error.

## STOP conditions

- Snapshot check fails after any commit → stop, do not push.
- Step 3 or 4 fix cannot preserve existing on-disk user data across an app restart →
  stop and report; a migration may be needed.
- Adding an `AbortSignal` to `TranscriptionProvider` requires changing more than the
  six provider files under `src/main/providers/` → stop, fall back to the
  between-chunk cancellation check.
- Any step tempts a broader `DictationService` refactor → out of scope; note it for a
  follow-up plan.

## Out of scope

- `DictationService` decomposition (`src/main/dictation.ts` is ~1200 lines on this
  branch).
- Notarization / signing credentials.
- The stale-state-after-16-hours and capsule-overlay issues in README Known
  Limitations.
- Reworking the 3-attempt STT escalation policy beyond the Step 2 decision.
