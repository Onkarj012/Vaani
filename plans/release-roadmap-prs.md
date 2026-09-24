# Release roadmap PR sequence

Baseline: `6044307` on `feat/reliability-and-text-pipeline`, reviewed 2026-09-22.
Source: local `docs/vaani-release-roadmap-report.md`, with the subsequent source-backed
review corrections incorporated below. That report is ignored by Git; this plan is
the tracked execution record.

The next release version is not assigned by this plan. Resolve whether the current
1.2.0 candidate is superseded before changing versions or producing release tags.
No publication, provider spending, telemetry, or recovery enablement is authorized
by a status change here.

## Branches and dependencies

PRs are review units, not promises to ship every item. PR 01 branches from the
baseline above, not from main. Dependent PRs stack on their predecessor until the
baseline and predecessors are integrated. Independent work may branch from the
same baseline and reconcile only its owned changes. Keep each PR independently
testable; do not include unrelated worktree files.

| PR | Branch | Deliverable | Depends on | Status |
|---|---|---|---|---|
| 01 | `fix/release-01-privacy-boundaries` | Preserve onboarding credentials; enforce offline formatting; redact diagnostic exports | baseline | IMPLEMENTED LOCALLY |
| 02 | `fix/release-02-session-consent` | Freeze session routes and define recording/recovery consent and upgrade defaults | 01 | TODO |
| 03 | `fix/release-03-insertion-safety` | Cancel pending insertion and preserve the intended target across failures | 02 | TODO |
| 04 | `fix/release-04-recovery-outcomes` | Store acknowledgements, readiness state, and truthful recovery UI | 02, 03 | TODO |
| 05 | `feat/release-05-dictionary-snippets` | Edit existing rules/snippets without losing metadata; expose stable options | 01 | TODO |
| 06 | `test/release-06-distribution` | Packaged candidate, architecture policy, installation/upgrade and updater checks | 01–05 or explicitly deferred scope | TODO |
| 07 | `research/release-07-language-pilot` | Small frozen multilingual development/evaluation corpus and script preference pilot | baseline | TODO |
| 08 | `feat/release-08-indic-cloud` | Optional single Indian-language provider adapter | 02, 07, API/terms decision | CONDITIONAL |
| 09 | `feat/release-09-local-runtime` | Functioning packaged local backend isolated from the main process | 02, local backend spike | TODO |
| 10 | `feat/release-10-local-multilingual` | One validated multilingual local model and model lifecycle | 07, 09 | TODO |
| 11 | `feat/release-11-cleanup-script` | Literal/light/polish modes, raw-text preservation, explicit script policy | 02, 07 | TODO |
| 12 | `feat/release-12-apple-speech` | Optional SpeechAnalyzer adapter | 07, packaged spike, OS/hardware decision | CONDITIONAL |

## Task list

Checkboxes mark completed local work on the current branch, not a merged PR or
public release. Each task belongs to the numbered PR above.

### 01 — Privacy boundaries

- [x] Preserve stored API keys when an onboarding field is blank, redacted, or untouched.
- [x] Keep key deletion behind the explicit Settings action.
- [x] Prevent cloud formatting and credential lookup in Always Offline mode.
- [x] Keep local STT failure from falling back to a cloud STT provider in Always Offline mode.
- [x] Make copied diagnostic reports exclude transcript, target content, error text, and audio paths by default.
- [x] Add regression tests and correct the offline-mode label and privacy documentation.
- [x] Pass the full test suite and typecheck.
- [x] Refresh the graph, review the final diff, and make the local branch reviewable.

### 02 — Session routes and consent

- [ ] Capture provider, model, language, formatter, failover, target, retention, and consent at session start.
- [ ] Use that configuration across transcription, formatting, and recovery retries; require an explicit route change.
- [ ] Keep secret key material out of persisted snapshots and let consent revocation take effect immediately.
- [ ] Separate ordinary recording consent from failed-audio retention; set safe upgrade/reset defaults.
- [ ] Test mid-session setting changes, recording deletion, expiry, storage bounds, and revocation.

### 03 — Insertion safety

- [ ] Cancel pending injection before external side effects and report uncertainty after dispatch.
- [ ] Remove automatic retry into a newly foregrounded app.
- [ ] Prevent duplicate insertion when the first outcome is unknown.
- [ ] Test focus changes, cancellation timing, delayed paste, and clipboard restoration.

### 04 — Recovery outcomes

- [ ] Return explicit store acknowledgement and distinguish text-only from audio-backed recovery.
- [ ] Stop `Saved for recovery` messages after a no-op or failed write.
- [ ] Define app-crash versus power-loss durability and test restart/fault paths.
- [ ] Publish disabled, initializing, ready, empty, and degraded recovery state through IPC and UI.
- [ ] Test missing entries, failed writes, unavailable keys, unknown schema, expiry, and partial persistence.
- [ ] Decide whether experimental opt-in recovery passes consent and fault gates; keep it disabled otherwise.

### 05 — Dictionary and snippets

- [ ] Edit existing entries in place without losing provenance or matching metadata.
- [ ] Expose only stable fuzzy, bare-trigger, and per-app options with collision guidance.
- [ ] Preserve all-app scope as an omitted `appProfileIds` field and test IPC round trips.

### 06 — Distribution and release evidence

- [ ] Resolve the 1.2.0 versus 1.3.0 release version and supported macOS/CPU matrix.
- [ ] Build DMG/ZIP with the native module and inspect the candidate artifacts.
- [ ] Test installation, first launch, permissions, update metadata, and upgrade from the previous public version.
- [ ] Prove settings, credentials, history, and consent survive upgrade.
- [ ] Run the real-app insertion smoke matrix and record wrong-target, duplicate, copy-only, and unreadable-field outcomes.
- [ ] Collect the soak observations; resolve any safety fault before release.
- [ ] Decide signing/notarization and publish only the verified supported artifact set when instructed.

### 07–08 — Language pilot and conditional cloud route

- [ ] Freeze a small speaker-balanced corpus and script expectations before model tuning.
- [ ] Measure literal and formatted output, technical terms, negation, names, latency, and cost with clear denominators.
- [ ] Check actual user preference for original versus Latin script.
- [ ] Review current provider API, model versions, privacy terms, licensing, and cost before a paid integration.
- [ ] If justified, implement one opt-in Indic cloud adapter and test cancellation, timeout, chunking, and script behavior.

### 09–12 — Local runtime and text behavior

- [ ] Prove real packaged local transcription; the checked-in Whisper functions are currently stubs.
- [ ] Choose and package a licensed backend with verified model downloads and integrity checks.
- [ ] Isolate inference from the Electron main process and test crash containment, cancellation, and cleanup.
- [ ] Measure cold/warm latency, memory, and zero-network behavior on supported hardware.
- [ ] Add one multilingual local baseline only after pilot evidence supports it.
- [ ] Build literal, light, and polish modes with raw transcript preservation and safe preview/revert behavior.
- [ ] Define and test script policy without silently translating speech.
- [ ] Evaluate SpeechAnalyzer only after packaged binding, asset, locale, and OS checks pass.

## PR 01: credential and privacy boundaries

- Blank, untouched, redacted, whitespace-only, or cancelled onboarding input must
  not delete a stored credential. Reuse the existing draft policy. Settings keeps
  its explicit clear action; no second deletion flow is needed in onboarding.
- `always-offline` must skip provider formatting before credential lookup or a
  provider call. Keep the raw transcript for existing deterministic cleanup. Cloud
  formatting remains available in auto/online modes. Selecting local STT alone is
  not the same as selecting an offline-only pipeline.
- Default bug-report export must use an explicit non-content allowlist. Exclude
  transcripts, snippets, target content, arbitrary provider error strings, and
  audio paths, including nested trace fields. Preserve useful diagnostic metadata.
  Normal user-requested history/data export is a separate feature and is unchanged.
- Regression tests cover blank/nonblank credential handling, offline provider-call
  suppression and existing online behavior, and serialized export content canaries.
- Run the full Vitest suite, typecheck, whitespace check, and `graphify update .`.
  No native code or dependency changes are part of this PR. Packaged runtime proof
  remains a later gate; passing unit tests does not establish release readiness.

## PR 02: session routes and consent

Capture provider/model, language, formatting, failover policy, target, and retention
policy at session start. Use the captured route across stages and recovery retries;
an intentional route change requires explicit user action. Never snapshot secret
key material into persisted metadata. Consent revocation overrides prior consent.

Separate ordinary WAV recording consent from failed-audio retention consent. Existing
`retainFailedAudio: true` defaults do not count as affirmative consent. Define
upgrade/reset behavior, deletion, expiry, storage bounds, and consent changes during
an active session. Update privacy copy. Recovery remains gated off.

Exit: mid-session settings changes do not silently change provider/billing; retries
follow the declared route; disabled retention writes no audio in its respective
path; revocation and upgrade tests pass.

## PR 03: insertion safety

Pass cancellation through pending clipboard/insertion work. Stop before side effects
that have not been dispatched; report uncertainty for actions already dispatched.
Never adopt a different foreground app as an automatic fallback target. A user may
explicitly choose a new target for manual retry. Define duplicate prevention when
the first insertion outcome is unknown, not only when it definitely failed.

Exit: tests cover cancellation during waits, focus changes within and across apps,
delayed paste, duplicate retries, and clipboard restoration after user clipboard
changes. Real-app checks distinguish successful insertion, safe refusal, copied
fallback, and unverifiable outcomes.

## PR 04: recovery acknowledgements and readiness

Represent write acknowledgement separately from retained content (text/audio).
The inspected history failure callers already await history writes; do not rewrite
them based on the report's overly broad claim. Fix recovery no-op paths that can
claim a save without an acknowledged entry. Define the promised durability boundary
(app crash/restart versus power loss) before choosing storage changes.

Expose authoritative disabled/initializing/ready/degraded readiness over IPC, with
empty content represented separately. Test missing entries, failed writes, unavailable
keys, unknown schemas, expiry, restart, and partial text/audio persistence. Keep
unknown schema data intact. Enable experimental recovery only after consent and
fault gates pass; otherwise ship an honest disabled state. Do not add telemetry.

## PR 05: dictionary and snippets

Add edit-in-place using existing UI primitives. Preserve provenance, enablement,
matching flags, hit metadata, and app scope. Only expose stable engine semantics.
Warn about ordinary-word bare-trigger collisions. Represent all-app scope by absent
`appProfileIds`, never an empty list. Test edits and round trips through IPC.

## PR 06: release candidate and distribution

Freeze a candidate commit and the supported OS/architecture matrix. Verify actual
DMG/ZIP creation with the native step intact, native addon loading, installation,
first launch permissions, upgrade from the previous public version, and preservation
of keys/settings/history. Check updater version, artifact architecture, URL and hash.
Choose signing/notarization policy before claiming a polished install experience.
Narrow support if hardware is unavailable; do not imply untested Intel support.

Run approximately ten ordinary trials in each declared supported app plus targeted
adversarial cases. Record build/app/macOS versions, field class, strategy, result,
and exclusions. Zero observed wrong-target writes, duplicate retries, false saved
claims, or forbidden uploads are blocking requirements. Ordinary insertion failures
need explicit dispositions; copying is not insertion. Manually classify unreadable
fields rather than hiding them from the denominator. This is a smoke matrix, not a
population reliability estimate or the existing scorer's per-app gate (100 eligible
trials/app and 20 represented app/field classes). Reconcile the scorer separately if
it will be used as a release decision.

Collect a 24-hour soak with sleep/wake, microphone reconnect, permission changes,
hotkeys, overlay and memory observations. The duration itself is not a pass gate;
any safety/privacy fault found still blocks release. Publish only after an explicit
release instruction. Keep candidate evidence and unsupported cases in the handoff.

## PRs 07–08: language pilot and optional cloud route

Pilot before substantial model integration. Start with about four consenting speakers
and 120 utterances spanning English, Indian English, Hindi-English and Marathi-English.
Avoid confounding language with speaker. Freeze development and held-out cases before
tuning; state when speaker holdout is too small for a general claim. Measure literal
and formatted outputs separately, technical tokens, names, numbers, negation, script
fidelity, latency and cost. Define normalization and transliteration expectations.

Competitor coverage is a hypothesis, not an empty-market fact; use primary sources
and paired tests before comparative claims. An adapter is conditional on current API,
license, cost and data-handling review, model/endpoint version, timeout/chunking,
cancellation, consent and script behavior. No paid calls without authorization.
Vocabulary import is follow-up scope only after a demonstrated user need and a
bounded consent/preview design; never scan repositories or upload terms silently.

## PRs 09–12: local runtime and text behavior

First prove actual local transcription: the checked-in build currently has Whisper
stubs without `VAANI_HAS_WHISPER`. Loading the addon is insufficient. Select and
package a real backend, then isolate it in a utility/child process. Verify model
load/unload, crash containment, cancellation, resource cleanup, cold/warm latency,
memory, and offline network behavior on supported hardware. Model downloads need
integrity, license, partial-download and storage handling. Add only one multilingual
baseline after the pilot supports it; retain smaller English models where useful.

Cleanup modes must preserve original ASR output and distinguish transcription from
translation/transliteration. Define script policy using pilot evidence. Offer safe
preview/history revert first; automatic undo inside arbitrary external editors needs
its own target/range validity design and is not implicitly authorized by this plan.

SpeechAnalyzer is optional and must prove packaged binding, language availability,
asset installation and OS/hardware compatibility. It does not silently raise the
whole app's minimum OS. Default-on recovery requires evidence from opt-in use and
support, not newly introduced telemetry; audio consent remains independent.

## Deferred

In-recording checkpoints, streaming insertion, selection rewriting, broad window
context, mobile, Windows, sync, teams, meetings, and autonomous voice commands.
Dates in the source report are aspirations until the baseline/package and local
backend spikes establish actual effort. Cut optional features before safety gates.
