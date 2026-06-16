# Plan 001: Move provider API keys out of settings and exports

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- src/main/store/credentials.ts src/main/store/settings.ts src/shared/types.ts src/renderer/components/SettingsModal.tsx src/main/ipc.ts src/main/transcription.ts`
> If any in-scope file changed since this plan was written, compare the current-state notes below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

Vaani handles cloud provider API keys. Today those keys live inside the settings object, are persisted to `~/.vaani/settings.json`, and are included in the renderer export payload. That makes accidental support exports and local file compromise enough to expose credentials. This plan moves keys behind a main-process credential backend and makes renderer/settings flows value-blind after save.

## Current state

- `src/main/store/credentials.ts` owns the credential cache. Lines 8-11 say keys are in memory but persisted via settings, and lines 32-45 load keys from settings while returning no cleanup patch.
- `src/shared/types.ts` includes `groqApiKey: string` and `providerApiKeys: ProviderApiKey[]` in `Settings`.
- `src/main/store/settings.ts:45` writes the whole settings object to JSON.
- `src/renderer/components/SettingsModal.tsx:161-163` exports `{ exportedAt, settings, history }`, which currently includes credential fields.
- `src/main/transcription.ts:101-114` resolves credentials first from `CredentialsStore`, then falls back to settings fields.

Repo conventions to match:

- Main-process business logic belongs under `src/main/*`.
- Use TypeScript strict mode and `import type` for types.
- Do not add a new dependency without asking. Prefer a native bridge or macOS command already available in the app if a Keychain wrapper cannot be implemented without dependency changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `bun test` | exit 0, all Vitest tests pass |
| Typecheck | `bun run typecheck` | exit 0, no TS errors |
| Native build check if native files change | `bun run build:native` | exit 0 |

## Scope

**In scope**:
- `src/main/store/credentials.ts`
- `src/main/store/settings.ts`
- `src/main/ipc.ts`
- `src/main/transcription.ts`
- `src/shared/types.ts`
- `src/renderer/components/SettingsModal.tsx`
- New focused tests under `tests/unit/`

**Out of scope**:
- Provider transcription behavior except credential lookup.
- Adding third-party packages without operator approval.
- Printing or logging any credential value.
- Changing history export format beyond redacting/removing credentials.

## Git workflow

- Branch suggestion: `advisor/001-keychain-credentials`
- Commit style in this repo commonly uses conventional prefixes, for example `fix: accessibility permission stuck on 'not granted' until restart`.
- Do not push unless instructed.

## Steps

### Step 1: Add a credential backend abstraction

In `src/main/store/credentials.ts`, replace the settings-backed persistence assumption with an interface such as `CredentialBackend` exposing `get`, `set`, `delete`, and `listKeys` or equivalent methods. Keep an in-memory implementation for tests. Add a macOS Keychain implementation if it can be done with existing native bridge/code patterns; otherwise STOP and ask whether to add a dependency such as `keytar` or extend `vaani_native.node`.

**Verify**: `bun run typecheck` -> exits 0.

### Step 2: Migrate legacy settings keys once

Update `migrateFromSettings(settings)` so it stores `settings.groqApiKey` and each `settings.providerApiKeys[].key` into the credential backend, then returns a `Partial<Settings>` patch that clears credential values from persisted settings. Preserve provider identifiers, but do not persist key values in settings.

**Verify**: Add or update a unit test proving legacy settings values are written to the credential backend and the returned patch clears persisted key fields. Run `bun test -- tests/unit/<new-test-file>.test.ts` -> new tests pass.

### Step 3: Make renderer settings value-blind

Update `SettingsModal` and IPC flows so the renderer can save a key but does not keep receiving saved key values in `getSettings`. Show configured state through `getProviderStatus` or a safe boolean/status shape, not by returning the secret. Ensure export data redacts credential fields even if legacy values still exist.

**Verify**: `bun run typecheck` -> exits 0.

### Step 4: Keep transcription lookup compatible

Update `TranscriptionService.resolveApiKey` and `registerIpcHandlers` to read credentials from the backend first. Keep temporary fallback to legacy settings values only for migration compatibility. Do not log key values.

**Verify**: `bun test` -> exits 0.

### Step 5: Add regression tests

Add tests for:
- Legacy settings migration stores keys in the backend and clears persisted fields.
- Export payload from `SettingsModal` or an extracted helper does not include key values.
- Provider configured status remains true when a key exists in the credential backend.

Use existing Vitest style from `tests/unit/dictation.test.ts` and `tests/unit/hotkeys.test.ts`.

**Verify**: `bun test && bun run typecheck` -> both exit 0.

## Done criteria

- [ ] No credential value is persisted by normal settings save/update paths.
- [ ] Exported settings/history data cannot contain provider key values.
- [ ] Existing users' legacy settings keys migrate without being lost.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] No files outside the in-scope list are modified except necessary tests and `plans/README.md`.

## STOP conditions

- The implementation requires adding a dependency and the operator has not approved it.
- Native Keychain access requires changing generated/build artifacts.
- A test or migration path would print or snapshot a real credential value.
- Settings shape drift makes it unclear how legacy keys should be preserved.

## Maintenance notes

Reviewers should scrutinize migration idempotency and export redaction. Future provider settings must use the credential backend API rather than adding new secret fields to `Settings`.
