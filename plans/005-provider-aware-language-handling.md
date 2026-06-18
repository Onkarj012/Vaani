# Plan 005: Make language choices provider-aware and honest

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1547c8a..HEAD -- src/main/providers/language.ts src/main/providers/local/whisperCpp.ts src/renderer/components/SettingsModal.tsx src/shared/defaults.ts tests/unit/language.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1547c8a`, 2026-06-17

## Why this matters

Users report language quality problems. The UI exposes many languages, but
provider behavior is uneven: Hinglish is sent as auto-detect for Whisper and
Deepgram, local Whisper models are English-only, and unsupported combinations are
not explained to the user. This plan makes language handling provider-aware so
Vaani can avoid silently applying a setting that the active provider cannot honor.

## Current state

- `src/renderer/components/SettingsModal.tsx` defines the language list locally.
- `src/main/providers/language.ts` normalizes language settings for Whisper and
  Deepgram.
- `src/main/providers/local/whisperCpp.ts` exposes only `.en` models.
- `tests/unit/language.test.ts` covers current helper behavior.

Relevant excerpts:

```tsx
// src/renderer/components/SettingsModal.tsx:43-50
const languages = [
  { value: 'auto', label: 'Auto-detect' }, { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' }, { value: 'ta', label: 'Tamil' }, { value: 'pa', label: 'Punjabi' },
  { value: 'mr', label: 'Marathi' }, { value: 'bn', label: 'Bengali' }, { value: 'gu', label: 'Gujarati' },
  { value: 'te', label: 'Telugu' }, { value: 'kn', label: 'Kannada' }, { value: 'ml', label: 'Malayalam' },
```

```ts
// src/main/providers/language.ts:21-29
export function normalizeWhisperLanguage(language: string | undefined): string | undefined {
  if (!language || language === "auto" || language === "hinglish") return undefined;
  return language;
}

export function normalizeDeepgramLanguage(language: string | undefined): string | null {
  if (!language || language === "auto" || language === "hinglish") return null;
  if (language === "zh") return "zh-CN";
  return language;
}
```

```ts
// src/main/providers/local/whisperCpp.ts:38-43
models: [
  { id: "tiny.en", name: "Tiny English (78 MB)" },
  { id: "base.en", name: "Base English (147 MB)" },
  { id: "small.en", name: "Small English (488 MB)" },
  { id: "medium.en", name: "Medium English (1.5 GB)" },
],
```

```ts
// tests/unit/language.test.ts:10-19
expect(normalizeWhisperLanguage("auto")).toBeUndefined();
expect(normalizeWhisperLanguage("hinglish")).toBeUndefined();
expect(normalizeWhisperLanguage("hi")).toBe("hi");
expect(normalizeDeepgramLanguage("auto")).toBeNull();
expect(normalizeDeepgramLanguage("hinglish")).toBeNull();
expect(normalizeDeepgramLanguage("zh")).toBe("zh-CN");
```

Repo conventions: shared product constants belong in `src/shared/defaults.ts` if
both main and renderer need them. Provider-specific logic belongs under
`src/main/providers/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Targeted tests | `bun run test language` | language tests pass |
| All tests | `bun run test` | all tests pass |
| Graph update | `graphify update .` | exits 0 after source changes |

## Scope

**In scope**:
- `src/main/providers/language.ts`
- `tests/unit/language.test.ts`
- `src/shared/defaults.ts` for shared language metadata if needed
- `src/renderer/components/SettingsModal.tsx` for provider-aware language UI copy/filtering
- `plans/README.md` status row

**Out of scope**:
- Adding new STT providers
- Downloading or bundling new local Whisper models
- Changing audio recording or injection
- Adding dependencies

## Git workflow

- Branch: `codex/005-provider-aware-language-handling`
- Commit message style: `fix: make language settings provider-aware`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define shared language metadata

Move the renderer-local `languages` array into a shared export, for example
`SUPPORTED_LANGUAGES` in `src/shared/defaults.ts` or a new shared file if that is
cleaner. Each entry should include:

- `value`
- `label`
- whether it is safe for Whisper-style providers
- whether it is safe for Deepgram
- whether it is supported by local English-only models

Keep labels identical unless improving clarity is necessary.

**Verify**: `bun run typecheck` -> exit 0 after imports are updated.

### Step 2: Add provider-aware helpers

In `src/main/providers/language.ts`, add helpers such as:

- `isLanguageSupportedByProvider(language, providerId, modelId?)`
- `resolveLanguageForProvider(language, providerId, modelId?)`

Behavior:

- `auto` remains supported everywhere.
- `hinglish` should remain prompt-driven for Whisper providers; do not pass a
  single language code.
- Deepgram should receive only language codes it supports; unsupported selections
  should resolve to `null` or a safe fallback and be surfaced to UI.
- Local `.en` models should support only `auto` and `en` unless a non-English
  local model is actually present.

Keep existing `normalizeWhisperLanguage` and `normalizeDeepgramLanguage` exports
for compatibility, but implement them through the shared logic if practical.

**Verify**: `bun run test language` -> existing tests still pass or are updated
to the new, explicit contract.

### Step 3: Make Settings UI provider-aware

In `src/renderer/components/SettingsModal.tsx`, import the shared language list.
When a language is not supported by the selected transcription provider/model,
either disable it in the select if the local `Select` component supports disabled
options, or show a concise warning under the language selector. Do not silently
hide languages in a way that makes settings appear to disappear.

For local Whisper English-only models, show clear copy that non-English language
settings require a cloud provider or future multilingual local model support.

**Verify**: `bun run typecheck` -> exit 0.

### Step 4: Add tests for provider-language compatibility

Extend `tests/unit/language.test.ts` with:

- Hinglish remains prompt-driven for Whisper and does not pass `"hi"` or `"en"` as
  a language code.
- Chinese maps to `zh-CN` for Deepgram.
- Local `tiny.en` rejects or warns for `hi`/`hinglish` while allowing `en` and
  `auto`.
- Unsupported language/provider pairs have deterministic fallback behavior.

**Verify**: `bun run test language` -> all language tests pass.

### Step 5: Full verification

**Verify**:
- `bun run test` -> all tests pass
- `bun run typecheck` -> exit 0
- `graphify update .` -> exit 0

## Test plan

- Extend `tests/unit/language.test.ts` for provider-aware support decisions and
  normalization outputs.
- Typecheck Settings UI because the shared language metadata changes imports and
  option shapes.
- Full suite catches provider-chain assumptions.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test language` exits 0
- [ ] `bun run test` exits 0
- [ ] `graphify update .` exits 0 after code changes
- [ ] Language metadata is not duplicated between main and renderer
- [ ] Unsupported provider/language combinations are explicit to the user
- [ ] Local English-only models do not silently pretend to support every language
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Provider support cannot be determined without live network calls.
- The local `Select` component cannot represent disabled options and adding that
  support grows into a broad UI refactor.
- Supporting non-English local Whisper requires new model downloads or packaging.

## Maintenance notes

Language support is a product contract. Any future STT provider or local model
should add its compatibility to the shared language metadata and the language
unit tests in the same change.
