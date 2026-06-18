# Plan 001: Make clipboard injection wait long enough to avoid stale clipboard pastes

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1547c8a..HEAD -- src/main/injection/clipboard.ts src/main/injection/index.ts tests/unit`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1547c8a`, 2026-06-17

## Why this matters

Users report that Vaani sometimes pastes the previous clipboard item instead of
the text that was just transcribed, even though the correct dictation is saved in
history. The clipboard-only injection path writes the dictated text, fires Cmd+V,
then restores the original clipboard after a fixed 80 ms. Some target apps do not
consume the clipboard synchronously; if the restore wins that race, the target
pastes the stale clipboard content. This plan makes clipboard restore delayed,
conditional, and test-covered so old clipboard text cannot be reintroduced during
the paste window.

## Current state

- `src/main/injection/clipboard.ts` owns clipboard-based insertion, including
  AppleScript Cmd+V, native paste, typing fallback, clipboard read/write, and
  delayed restoration.
- `src/main/injection/index.ts` selects AX vs clipboard and already stops after
  one clipboard attempt for clipboard-only targets.
- `tests/unit/injectionStrategy.test.ts` covers high-level strategy selection,
  but there is no unit test for clipboard restoration timing.

Relevant excerpts:

```ts
// src/main/injection/clipboard.ts:20-24
async inject(text: string, target?: InjectionTarget): Promise<InjectionResult> {
  const original = await readClipboardText();
  try {
    await writeClipboardText(text);
    await delay(180);
```

```ts
// src/main/injection/clipboard.ts:34-45
if (isClipboardOnlyTarget(target)) {
  await ensureTargetReady(target);
  await moveCaretToEndForBrowserTarget(target);
  const ok = await this.pasteWithAppleScript(target);
  if (ok) {
    await delay(80);
    if (original !== text) {
      await writeClipboardText(original);
```

```ts
// src/main/injection/clipboard.ts:106-112
} finally {
  if (original !== text) {
    void restoreClipboardAfterDelay(original, text, 400);
  }
}
```

```ts
// src/main/injection/clipboard.ts:214-220
async function restoreClipboardAfterDelay(original: string, injected: string, delayMs: number): Promise<void> {
  await delay(delayMs);
  const current = await readClipboardText();
  if (current === injected) {
    await writeClipboardText(original);
  }
}
```

Repo conventions: TypeScript strict mode, path aliases, Vitest tests under
`tests/unit`, and no new dependencies. Follow the existing `vi.mock` style in
`tests/unit/injectionStrategy.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Targeted tests | `bun run test clipboard` | new and related tests pass |
| All tests | `bun run test` | all tests pass |
| Graph update | `graphify update .` | exits 0 after source changes |

## Scope

**In scope**:
- `src/main/injection/clipboard.ts`
- `tests/unit/clipboardTextInjector.test.ts` (create)
- `tests/unit/injectionStrategy.test.ts` only if a strategy assertion must be adjusted for the same behavior
- `plans/README.md` status row

**Out of scope**:
- Native addon code in `src/native/`
- Transcription, formatting, history, tray, or settings UI
- Any new dependency
- Changing the public `InjectionResult` type

## Git workflow

- Branch: `codex/001-fix-clipboard-stale-paste`
- Commit message style: conventional commits, for example `fix: prevent stale clipboard paste during injection`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Replace the 80 ms restore with one restore path

In `src/main/injection/clipboard.ts`, remove the special immediate restore block
inside `isClipboardOnlyTarget(target)`. Clipboard-only targets should paste once,
return success/failure, and rely on a single shared restore path in `finally`.

Add a named constant near the top:

```ts
const CLIPBOARD_RESTORE_DELAY_MS = 1_200;
```

Use that constant for all clipboard restoration. Keep the existing conditional
guard inside `restoreClipboardAfterDelay`: it must only restore if the current
clipboard still equals the injected text. Do not clear the clipboard when
`original === text`; if original and injected match, restoring does not help and
clearing creates a new race.

**Verify**: `bun run typecheck` -> exit 0.

### Step 2: Make restoration cancellation-safe across overlapping injections

Add a module-level monotonically increasing token:

```ts
let restoreGeneration = 0;
```

Each `inject()` call should increment it once after reading `original`, keep the
local generation, and pass it to `restoreClipboardAfterDelay`. The restore helper
should no-op if its generation is no longer current. This prevents an older
dictation's delayed restore from overwriting a newer dictation's clipboard text.

Keep `consecutiveFailures` behavior unchanged.

**Verify**: `bun run typecheck` -> exit 0.

### Step 3: Add unit tests for restore timing and stale-restore prevention

Create `tests/unit/clipboardTextInjector.test.ts`. Mock:

- `electron` clipboard read/write methods
- `node:child_process` `execFile` and `execFileSync`
- `@main/nativeBridge`
- `@main/injection/target` readiness/frontmost helpers if needed

Use `vi.useFakeTimers()` so the test can prove exact timing. Cover:

- Clipboard-only target: after `inject("dictated", chromeTarget)`, original
  clipboard is not restored before `CLIPBOARD_RESTORE_DELAY_MS`.
- After the delay, original clipboard is restored only when clipboard still
  equals the injected text.
- If clipboard changes to some other user value before the restore fires, Vaani
  does not overwrite it.
- Two injections close together: the first delayed restore does not overwrite the
  second injected text or its eventual restore.

The tests must not execute real `osascript`, `pbcopy`, or `pbpaste`.

**Verify**: `bun run test clipboard` -> all new tests pass.

### Step 4: Full verification

Run the full repo checks.

**Verify**:
- `bun run test` -> all tests pass
- `bun run typecheck` -> exit 0
- `graphify update .` -> exit 0

## Test plan

- New `tests/unit/clipboardTextInjector.test.ts` using Vitest fake timers.
- Regression cases focus on the exact user bug: previous clipboard content must
  not be restored quickly enough to become the target app's pasted value.
- Existing `tests/unit/injectionStrategy.test.ts` should continue to pass,
  confirming strategy selection did not change.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test clipboard` exits 0 with the new timing tests
- [ ] `bun run test` exits 0
- [ ] `graphify update .` exits 0 after code changes
- [ ] `grep -n "await delay(80)" src/main/injection/clipboard.ts` returns no matches
- [ ] Clipboard restoration is conditional on current clipboard still matching injected text
- [ ] Overlapping injections cannot be restored by an older pending restore
- [ ] No files outside the in-scope list are modified except graphify output if the command updates it
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Clipboard restoration currently differs from the excerpts above.
- A robust test requires real macOS paste events, real `osascript`, or real clipboard access.
- The fix appears to require changing native `PasteText` or the public `InjectionResult` type.
- Any existing injection test fails after two reasonable attempts to keep behavior compatible.

## Maintenance notes

Future injection work should avoid fixed short sleeps after paste events. Reviewer
should scrutinize the restore timing and generation guard, because this is the
path most likely to reintroduce the stale-clipboard race.
