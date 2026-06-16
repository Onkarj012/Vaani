# Plan 005: Guard overlay prompt listeners against window creation races

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- src/main/overlay.ts src/preload/overlay.ts src/renderer/overlay tests`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

Dictionary and snippet prompts are shown from the overlay window. Today the prompt methods call `show()`, which can create/load the window asynchronously, but they attach response listeners immediately through optional chaining. If `this.window` is still null, no listener is registered and the user's later response can be ignored until timeout.

## Current state

- `src/main/overlay.ts:170-205` implements `showSnippetPrompt`.
- `src/main/overlay.ts:173` calls `this.show()`.
- `src/main/overlay.ts:202-203` captures `this.window` and conditionally registers `capsule:snippet-response`.
- `src/main/overlay.ts:208-241` repeats the same pattern for dictionary prompts.
- `src/main/overlay.ts:326-341` has `ensureWindow()`, which returns a promise for window creation.

Repo conventions to match:

- Overlay lifecycle is centralized in `OverlayController`.
- Avoid window lifecycle changes that affect Dock visibility unless specifically verified.
- Preserve focus behavior and existing prompt timeout semantics.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `bun test -- tests/unit/<overlay-test>.test.ts` | new tests pass |
| Full tests | `bun test` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `src/main/overlay.ts`
- New tests under `tests/unit/` if overlay can be mocked cleanly

**Out of scope**:
- Large overlay lifecycle refactor.
- Changing overlay renderer UI.
- Startup prewarm or hidden-window creation unless explicitly required and verified not to affect Dock visibility.

## Git workflow

- Branch suggestion: `advisor/005-overlay-prompt-race`
- Commit message example: `fix: register overlay prompt listeners after window creation`

## Steps

### Step 1: Make prompt methods await window availability

Refactor `showSnippetPrompt` and `showDictionaryPrompt` to ensure a window exists before registering the one-shot response listener. If keeping public methods `void`, delegate to private async helpers and handle failure by resolving `false`.

**Verify**: `bun run typecheck` -> exits 0.

### Step 2: Register listeners before showing prompt UI

Ensure the response listener is attached before `capsule:show-snippet` or `capsule:show-dictionary` is sent. Keep `pendingPromptRemover` cleanup behavior and prompt timeout behavior.

**Verify**: `bun run typecheck` -> exits 0.

### Step 3: Remove duplicated readiness polling if safe

If a small helper can wait for `loadReady` without broad lifecycle changes, use it for both prompt types. Keep this narrow. If it starts becoming a larger overlay state-machine refactor, STOP and leave that for a separate plan.

**Verify**: `bun test` -> exits 0.

### Step 4: Add regression coverage

Add a test or tightly scoped fake that simulates `this.window` being null when a prompt is requested, then becoming available. Assert the listener is registered and the callback resolves on response.

**Verify**: focused test command -> passes.

## Test plan

- Prompt requested before overlay window exists still registers response listener.
- Prompt timeout still resolves `false`.
- `destroy()`/`endPrompt()` still removes pending listeners.

## Done criteria

- [ ] No optional listener registration can silently skip because `this.window` is null after prompt request.
- [ ] Prompt response callback resolves when renderer sends response.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] No broad overlay prewarm or Dock/window activation behavior changed.

## STOP conditions

- The fix requires changing main window lifecycle or Dock activation behavior.
- Prompt tests require real macOS windows instead of mocks.
- Refactor grows into a full overlay state-machine rewrite.

## Maintenance notes

This plan fixes the immediate prompt race only. A later overlay-readiness consolidation can still simplify watchdog and retry paths, but should start from characterization tests.
