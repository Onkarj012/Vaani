# Plan 002: Validate the submitted provider API key

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- src/main/ipc.ts src/main/providers src/shared/types.ts src/preload/index.ts src/renderer/components/SettingsModal.tsx tests`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

The Settings UI exposes API-key testing, but the main-process handler ignores the submitted key and checks provider availability instead. Several provider `isAvailable()` methods simply return `true`, so invalid or empty keys can appear valid. Users then discover the failure only when dictation or formatting runs.

## Current state

- `src/main/ipc.ts:222` registers `IpcChannel.TestApiKey` as `(_e, providerId: string, _apiKey: string)`.
- The `_apiKey` parameter is not used.
- `src/main/providers/types.ts:9` defines `isAvailable(): Promise<boolean>` with no key argument.
- `src/main/providers/groq/groqStt.ts:103-105` returns `true` from `isAvailable()`.
- `src/main/providers/openai/openaiStt.ts:79-81` returns `true` from `isAvailable()`.

Repo conventions to match:

- Provider logic lives under `src/main/providers/*`.
- User-facing errors should be generic and must not echo API keys.
- IPC channel compatibility must be preserved across `src/shared/ipc.ts`, preload, and renderer consumers.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `bun test -- tests/unit/<new-test-file>.test.ts` | new tests pass |
| Full tests | `bun test` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `src/main/ipc.ts`
- `src/main/providers/types.ts`
- Provider files under `src/main/providers/*`
- `src/renderer/components/SettingsModal.tsx` only if UI response handling needs adjustment
- New tests under `tests/unit/`

**Out of scope**:
- Changing how keys are stored. That is Plan 001.
- Sending real credentials in tests.
- Performing long or expensive transcription calls just to validate a key.

## Git workflow

- Branch suggestion: `advisor/002-validate-provider-key`
- Commit message example: `fix: validate submitted provider api key`

## Steps

### Step 1: Define a validation contract

Add a provider-level method such as `validateApiKey(apiKey: string): Promise<{ valid: boolean; message: string }>` or a shared helper that can validate a key with a lightweight provider endpoint. Keep the old `isAvailable()` behavior if other app flows depend on it.

**Verify**: `bun run typecheck` -> exits 0.

### Step 2: Implement provider-specific validation

Implement validation for each cloud provider that appears in `KNOWN_PROVIDERS`: Groq, OpenAI, Deepgram, Anthropic, OpenRouter, and OpenAI-compatible where feasible. Use minimal requests and short timeouts. For providers where no lightweight validation endpoint is available, return a clear "cannot validate without a request" message and do not claim success.

**Verify**: `bun run typecheck` -> exits 0.

### Step 3: Update the IPC handler to use the submitted key

Change `IpcChannel.TestApiKey` in `src/main/ipc.ts` so it trims and validates the submitted key. Empty keys should return `{ valid: false, message: ... }`. Never log or return the key. Keep the handler result shape compatible with `VaaniAPI.testApiKey`.

**Verify**: Add a unit test with fake provider implementations showing the handler passes the submitted key into validation and rejects empty keys. Run the focused test -> passes.

### Step 4: Keep UI behavior honest

If `SettingsModal` currently treats any successful IPC response as configured, ensure it displays the returned `valid` boolean and message without assuming success. Do not store test keys unless the user explicitly saves through the existing save flow.

**Verify**: `bun run typecheck` -> exits 0.

## Test plan

- Test empty key returns invalid.
- Test a fake provider receives the exact submitted key.
- Test provider lookup failure returns invalid without throwing.
- Test provider validation errors become generic invalid messages.

Model tests after `tests/unit/dictation.test.ts`: mock Electron and provider registry as needed.

## Done criteria

- [ ] `TestApiKey` no longer ignores its `apiKey` argument.
- [ ] Empty or invalid keys cannot be reported as valid solely because a provider exists.
- [ ] No test logs or snapshots include real key values.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.

## STOP conditions

- Provider SDKs require network calls that cannot be made deterministic in tests.
- A provider has no safe validation path and the UX decision is unclear.
- Implementing validation requires a new dependency without approval.

## Maintenance notes

Keep availability/status checks separate from key validation. Availability can answer "is this provider integrated"; validation must answer "does this submitted credential work."
