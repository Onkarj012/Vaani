# M1: trustworthy daily driver

Created 2026-09-26. Branch `feat/release-safety-completion`, stacked on
`feat/reliability-and-text-pipeline` (`6044307`). This file is the working plan
for the first milestone in `plans/release-roadmap-prs.md`.

## Goal

Vaani replaces Wispr Flow for the owner's daily English dictation on one Mac.
The intended text reaches the intended field exactly once, fast enough that the
owner doesn't miss Wispr.

This is a personal acceptance trial on one machine. It is not a benchmark, a
public release, or a claim about other hardware.

Dates:

- Build work: 2026-09-26 to 2026-09-30.
- Freeze: end of 2026-09-30.
- Acceptance: 2026-10-01 to 2026-10-03.

If the gates miss, the owner keeps the build as a trial build with named
blockers, and M1 stays open.

## Scope

In scope:

- The owner's setup is about 95% English. Toggle mode, `injectionMode: auto`,
  Groq STT, Groq LLM formatting, renderer capture backend.
- Built-in MacBook microphone only. Earphone mics duck the earphone output, so
  M1 never opens a Bluetooth input.
- Daily apps are T3 Code, ChatGPT, Zen, Ghostty, Brave and Comet.

Out of scope:

- STT provider failover. Groq went 167/167 in the field data.
- PR05 dictionary and snippet editing.
- Public packaging, signing and notarization.
- Multilingual and local models, cleanup modes, and SpeechAnalyzer.
- Audio retention and the planned 7-day stored-audio retry.
- Enabling recovery. It stays disabled.

## Why these items

Field data comes from 200 traces, 2026-07-25 to 08-22, on builds before
`6044307`:

| Signal | Count or value |
|---|---|
| Verified insertion | 104 |
| "Saved to history" after a paste with failed verification | 55 |
| No speech / recorder unavailable / fragment | 13 / 10 / 5 |
| Failed | 10 |
| Stuck at `started` | 3 |
| Groq STT success | 167/167 (p50 610 ms) |
| LLM formatting success | 161/161 (p50 301 ms) |
| Hotkey release to completion | p50 2.8 s, p90 4.1 s |

The owner also reports trailing words that were cut or missing, and dictionary
or snippet text that appeared without being spoken.

Code findings. Luna explored, Astra critiqued, and the lead spot-checked:

| # | Finding | Location |
|---|---|---|
| F1 | Dictionary `written` terms and snippet `content` go to Whisper as the STT `prompt`. Whisper can copy prompt text into its output, mostly on short or quiet clips. | `src/main/transcription.ts:122,152,661` |
| F2 | The renderer recorder keeps a fixed 300 ms after stop, with no drain or quiet check. The native backend drains. | `src/renderer/recorder/main.ts:17`, `src/main/audio/nativeCapture.ts:6-11` |
| F3 | A formatting deadline fails the session although the corrected transcript already exists. | `src/main/dictation.ts:497-500` |
| F4 | Verification returns early only on success. Every unconfirmed insertion waits the full 2 s. | `src/main/dictation.ts:69-70,1778-1801` |
| F5 | The 60 s stale-session guard resets state without finishing the trace. | `src/main/dictation.ts:184-191` |
| F6 | Paste-latest pastes the newest history entry, not the failed session's text. | `src/main/dictation.ts:910` |
| F7 | Clipboard insertion waits 180 ms before the paste and 600 ms after it. Target activation adds 200-1,050 ms. | `src/main/injection/clipboard.ts:31-38,108-114` |
| F8 | Renderer capture requests `echoCancellation: true`. Its effect on output ducking is unverified. | `src/renderer/recorder/main.ts:243` |
| F9 | The trace has no stage timing for stop, finalize, dispatch or verification. | `src/shared/types.ts:197-221` |

Current settings: 3 dictionary corrections, none fuzzy, no snippets,
`preWarmMic: false`, `inputDeviceId: "default"`.

## Insertion outcomes and status copy

Delivery certainty is separate from the history and clipboard result.

| Outcome | Meaning | Status text |
|---|---|---|
| `verified` | Readback shows the text | "Inserted." |
| `unconfirmed` | Paste dispatched, or may have. Delivery unknown. | "Insertion unconfirmed. Check the field before pasting again." |
| `refused` | Target or cancel guard stopped dispatch | "Not inserted: target changed." The overlay offers the text. |
| `copy-only` | No insertion attempted. Clipboard write succeeded. | "Copied. Paste when ready." |
| `failed` | A stage failed, or insertion is known incomplete | Names the stage and says where the text is |

Rules:

- "Saved" appears only after a store acknowledgement.
- An `unconfirmed` outcome never triggers automatic re-dispatch.
- `unconfirmed` plus a clipboard copy stays `unconfirmed`.

## Work items

Each item lists the change, files, tests and done condition. Commit each item
separately. After each commit, run:

- `bun run test`
- `bun run typecheck`
- `git diff --check`
- `graphify update .`

Never stage `t3.json` or `vaani-reliability-report.html`.

### 0. Settle the working tree (Sep 26)

The tree holds three unverified streams: PR03 insertion safety (Opus), PR04
readiness (parent) and PR05 editing (Luna, stopped on a 429).

- Read the full diff, grouped by owner. Check `Snippets.tsx`, `Dictionary.tsx`
  and `textRuleEdits.ts` for incomplete writes.
- PR05 is out of M1. If it passes tests, commit it separately as
  `feat(text-rules): edit dictionary and snippets in place`. If it doesn't,
  move those files to a `wip/pr05-edit-in-place` branch. Either way, the M1
  count doesn't depend on it.
- Done when the full suite and typecheck pass on the combined tree.

### 1. Finish insertion safety (Sep 26-27), PR03

Close the gaps Opus reported:

- An `osascript` failure after a partial dispatch must report `unconfirmed`,
  not fall through to another strategy.
- `retryRecoveryInsertion` refuses when the prior outcome is uncertain. Add a
  test.
- A session cancelled after dispatch ends with a terminal outcome, not a
  pending recovery state.
- The clipboard-restore comparison can't tell a user copy from identical
  dictated text. Document this and don't restore over a user change.

Files: `src/main/injection/{index,clipboard,accessibility,guard}.ts`,
`src/main/dictation.ts`.

Tests go in `tests/unit/injectionStrategy.test.ts`,
`clipboardTextInjector.test.ts` and `dictation.test.ts`. Cover:

- Cancel during waits
- Focus change within an app and across apps
- Delayed paste
- A duplicate retry after an unknown outcome
- A user clipboard change during insertion

Done when no code path re-dispatches after an uncertain dispatch, and every
case above has a test.

### 2. Outcome split and honest copy (Sep 27), PR03 + minimal PR04

- Add an insertion outcome type with the five values in the table above.
  Record it in the trace.
- Map user messages from the outcome and the store acknowledgement, never from
  fallbacks. Remove the "Saved to history" fallback text at
  `dictation.ts:1484-1514`.
- F6: leave paste-latest as is, but word the status for `unconfirmed` and
  `failed` so it points to History for that session, not to paste-latest.
- Commit PR04 readiness only if its tests pass. Recovery stays disabled.

Files: `src/shared/types.ts`, `src/main/dictation.ts`,
`src/main/store/dictationTrace.ts` (sanitizer), overlay and status copy.

Tests:

- One per outcome class.
- A history write that fails means no "Saved" copy.
- An unknown trace schema is preserved.

Done when no path shows "Saved" without an acknowledgement.

### 3. Stop phantom text (Sep 28), new

F1 changes:

- Stop sending snippet `content` in the STT prompt.
- Send dictionary terms only when the trimmed clip is at least 2 s and passed
  the speech gate.
- Keep the 600-char and 24-term caps.

Also check the cleanup paths that can add text on their own: the fuzzy
correction at `src/main/text/cleanup.ts:352` and bare-trigger snippets at
`cleanup.ts:428`. Both are opt-in and currently off for the owner. Confirm with
tests that they can't fire on unrelated words.

Tests:

- `buildSpeechContextPrompt` excludes snippets.
- The prompt is omitted for short clips.
- Cleanup doesn't insert a dictionary term that isn't in the transcript.

Probe: 20 short and quiet dictations (1-3 words, pauses) with dictionary terms
configured. Done when no probe contains unspoken dictionary or snippet text.

### 4. Stop trailing loss (Sep 29), new

First, measure. Add to the trace:

- The last-frame timestamp relative to the stop request
- Trailing RMS over the final 300 ms

Run 20 probe dictations that end in a distinctive word, releasing the hotkey
right on the last syllable. Classify each loss:

- Lost in audio: the word isn't in the raw transcript.
- Lost in the formatter: it's in the raw transcript but not the cleaned text.

Fixes:

- **Audio loss.** Give the renderer backend the native drain rule (300 ms
  grace, then wait for 120 ms of quiet, max 1,200 ms), or raise the grace if a
  drain isn't possible from the renderer.
- **Formatter loss.** Make the content guard compare the final words of the
  raw and formatted text, and fall back to corrected raw text when they differ.
  The guard already retries on dropped words (`formatting-constants.ts:28`).

Files: `src/renderer/recorder/main.ts`, `src/main/transcription.ts` or the
guard module, and trace types.

Done when 20/20 probes keep the final word.

### 5. Deadline and stale-session fixes (Sep 28), new

- F3: on `TranscriptionDeadlineExceededError` during formatting, continue with
  `correctedText` and record `formatterUsed: "none"` with reason `timeout`.
  Don't fail the session.
- F5: when the stale guard fires, finish the trace as `failed`, reason
  `stale-session`, with the stage it was stuck in, and show a status message.

Tests in `dictation.test.ts`:

- A formatter deadline still inserts the corrected text.
- A stale guard produces a terminal trace.

### 6. Stage timing and scorecard (Sep 29), new

F9: add timestamps to the trace, all optional:

- `stopRequestedAt`
- `clipReadyAt`
- `sttDoneAt`
- `formatDoneAt`
- `dispatchAt`
- `verifyDoneAt`

`completedAt` already exists. Add a test for the sanitizer round trip.

Add `scripts/m1-scorecard.mjs`, which reads `~/.vaani/dictation-traces.json`
and writes `~/.vaani/m1-scorecard.csv`:

- One row per session: id, time, app, duration bucket, outcome, status text,
  and stage durations.
- Blank columns the owner fills in: `landed_once` (y/n/partial/dup),
  `usable` (y/n) and `note`.
- Existing labels survive re-runs, joined on session id.
- A summary line: counts, per-app failures, p50/p90 per stage.

The script must print no transcript text. Traces keep only the last 200
sessions, so run it at least daily during acceptance.

### 7. Mic pinning and ducking check (Sep 28), new

- Make device selection refuse Bluetooth and Bluetooth LE inputs when no
  explicit device is chosen. `default` resolves to built-in. Add a test in the
  device selection tests.
- Ducking probe: play audio through the earphones and dictate 5 times. If the
  output ducks with `echoCancellation: true`, try `false` and compare
  transcripts on the same 5 phrases. Keep whichever doesn't duck and doesn't
  hurt accuracy.
- Try `preWarmMic: true` for the acceptance run if it removes "recorder not
  ready" on cold start. Record the choice.

### 8. Installed build (Sep 30), PR06 subset

- Run `bun run build`. The `build:native` step stays in place. Install over the
  current app.
- Check:
  - The native addon loads.
  - Microphone and Accessibility permissions survive the reinstall.
  - Hotkey, overlay and relaunch work.
- Record the commit hash, app version and settings in the scorecard header.
  This is the frozen candidate.

### 9. Cut the biggest wait (Sep 30 morning, optional), new

Only with item 6 data, and only before the freeze. Start with F4: don't block
the next dictation or the status on the 2 s verification in apps where
readback is known to be weak, or report `unconfirmed` sooner. Then look at F7.

Change one wait at a time. Rerun item 1's tests and 10 focus-change probes
after each change. Cut this item first if time runs short.

### 10. Acceptance (Oct 1-3), new

- 100 consecutive intended dictations on the frozen build, at least 10 per
  daily app. Label each one right away in the scorecard.
- Keep deliberate probes in a separate section. These don't count toward the
  100:
  - Cancellation
  - Focus changes
  - Silence
  - Five cold launches
  - Ten sleep/wake cycles
  - One 8-hour uptime session with periodic dictation
- About 20 matched non-sensitive dictations in Vaani and Wispr, same apps,
  alternating order. Compare corrections, interruptions and hand-timed release
  to visible text.
- A behavior-changing fix restarts the count. Copy or docs fixes don't.

## Exit criteria

1. There is one identified installed build, with 100 consecutive dictations
   over at least three days.
2. At least 98/100 deliver usable intended text exactly once, as labelled by
   the owner. Failed starts and false rejects count as failures.
3. Zero wrong-field writes, app-caused duplicates, phantom dictionary or
   snippet text, and dropped final words, across acceptance and probes.
4. Every session ends in one of the five outcomes, and its transcript is
   retrievable in History.
5. The built-in mic is used, with no output ducking. Cold launch, sleep/wake
   and the 8-hour run pass with no "recorder not ready" after readiness shows.
6. For successful dictations up to 30 s, release to visible text is at most
   2.5 s at p50 and 4 s at p90. The stretch target is 2 s and 3 s.

## Schedule

| Day | Items |
|---|---|
| Sat Sep 26 | 0, start 1 |
| Sun Sep 27 | 1, 2 |
| Mon Sep 28 | 3, 5, 7 |
| Tue Sep 29 | 4, 6. Labelled daily use starts on a dev build. |
| Wed Sep 30 | 9 (optional), 8, freeze, open the PR |
| Thu Oct 1 to Sat Oct 3 | 10 |

If the build days slip, cut in this order:

1. Item 9
2. The Wispr comparison
3. The ducking A/B, keeping the Bluetooth refusal

Never cut items 1-5 or the acceptance days.

## PR and review

Open one PR from `feat/release-safety-completion` against
`feat/reliability-and-text-pipeline` at the freeze. The PR description lists
each item, the tests run and what is unverified. CodeRabbit and GraphQL review
threads get handled during acceptance. A behavior-changing review fix restarts
the acceptance count. Merging needs the owner.

## Risks

| Risk | Guard |
|---|---|
| Faster insertion causes focus races or wrong-target writes | One wait change at a time. Focus-change probes after each. Target checks stay. |
| `unconfirmed` hides real failures | The owner's labels are the metric, not the outcome field. |
| Removing prompt terms hurts spelling of dictionary words | Dictionary corrections still run after STT. Compare 10 dictations using those terms before and after. |
| A longer stop tail adds latency | Drain stops on quiet. Item 6 measures the cost. |
| The 200-trace cap drops data before labelling | Run the scorecard daily. Labels live in the CSV. |

## Source notes

- `/tmp/vaani-m1/luna-out.md` holds the codebase exploration.
- `/tmp/vaani-m1/astra-out.md` holds the M1 critique.
- Both are temporary and untracked.
