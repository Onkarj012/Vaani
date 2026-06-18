# Plan 004: Add deterministic number normalization for common dictation phrases

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1547c8a..HEAD -- src/main/text/cleanup.ts src/main/providers/groq/groqLlm.ts src/main/providers/openai/openaiLlm.ts src/main/providers/formatting-constants.ts tests/unit/cleanup.test.ts tests/unit/formatting.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1547c8a`, 2026-06-17

## Why this matters

Users expect common numbers to appear as digits in dictation output. Today that
behavior depends mostly on the STT provider and LLM formatter, so it is
inconsistent: sometimes "ten" becomes `10`, sometimes it remains a word. A small
deterministic cleanup pass for common number phrases gives predictable output for
ordinary dictation while leaving prose and list cues intact.

## Current state

- `src/main/text/cleanup.ts` performs deterministic cleanup after transcription
  and formatting.
- LLM prompts in provider files mention list cue conversion but do not guarantee
  general numeral normalization.
- `tests/unit/cleanup.test.ts` covers punctuation, snippets, lists, duplicate
  words, and common artifacts, but not number normalization.

Relevant excerpts:

```ts
// src/main/text/cleanup.ts:106-117
export function cleanupText({ rawText, settings }: TextCleanupInput): string {
  const artifactNormalized = normalizeCommonDictationArtifacts(rawText);

  if (!settings.cleanupEnabled) {
    const deduped = collapseAdjacentDuplicateWords(artifactNormalized);
    return hasMultipleLines(deduped) ? normalizeLineWhitespace(deduped) : normalizeWhitespace(deduped);
  }

  const fillered = removeFillers(artifactNormalized, settings.fillerWords);
  const corrected = applyCorrections(fillered, settings.customCorrections ?? []);
  const snippeted = applySnippets(corrected, settings.snippets ?? []);
```

```ts
// src/main/providers/groq/groqLlm.ts:19-21
"NUMBERED LISTS — If the speaker uses number cues (one/two/three, first/second/third, number one/two, 1/2/3) before each item:",
"- Format as a numbered list: '1.' '2.' '3.' — one item per line",
"- Remove the spoken number cue word and replace with the digit marker",
```

```ts
// src/main/providers/openai/openaiLlm.ts:13-19
const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content.",
  "Keep every word. Add periods, commas, question marks.",
  "Capitalize sentences. Convert 'number one' → '1.', 'bullet point' → '-'.",
```

Repo conventions: deterministic text transformations live in
`src/main/text/cleanup.ts` and are tested in `tests/unit/cleanup.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Targeted tests | `bun run test cleanup` | cleanup tests pass |
| All tests | `bun run test` | all tests pass |
| Graph update | `graphify update .` | exits 0 after source changes |

## Scope

**In scope**:
- `src/main/text/cleanup.ts`
- `tests/unit/cleanup.test.ts`
- Provider formatting prompts only if needed to avoid contradiction
- `plans/README.md` status row

**Out of scope**:
- New LLM/provider dependencies
- Locale-specific number parsing beyond the supported English phrases in this plan
- Changing STT providers
- Converting all number-like words in every language

## Git workflow

- Branch: `codex/004-add-deterministic-number-normalization`
- Commit message style: `fix: normalize common dictated numbers`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a focused number-normalization helper

In `src/main/text/cleanup.ts`, add a helper such as
`normalizeCommonNumbers(text: string): string`.

Support these common English cases:

- zero through twenty as standalone numeric values
- tens from thirty through ninety
- simple compounds like "twenty one" through "ninety nine"
- "one hundred" through "nine hundred"
- percent phrases like "ten percent" -> `10%`
- currency phrases like "ten dollars" -> `$10` only if the existing wording is a
  simple amount phrase; avoid complex currencies

Do not normalize:

- Ordinal/list cue words at line starts like "first", "second", "third"
- Numbered-list cue phrases that the LLM already turned into `1.`, `2.`
- Common idioms where digits look worse, such as "one of", "one more thing",
  "at one point", "one by one", "ten out of ten" unless you add explicit tests
  proving desired behavior
- Non-English words

Keep the helper small and conservative. It is better to miss a complex number
than to damage prose.

**Verify**: `bun run typecheck` -> exit 0.

### Step 2: Call the helper in the cleanup pipeline

Apply number normalization after snippets/custom corrections and before sentence
capitalization/punctuation. It should run only when `cleanupEnabled` is true. If
cleanup is disabled, preserve today's behavior except existing artifact
normalization and whitespace cleanup.

**Verify**: `bun run typecheck` -> exit 0.

### Step 3: Add regression tests

Extend `tests/unit/cleanup.test.ts` with cases:

- `"I need ten apples"` -> `"I need 10 apples."`
- `"Set the limit to twenty five percent"` -> `"Set the limit to 25%."`
- `"The budget is ten dollars"` -> `"The budget is $10."`
- `"I have one more thing"` stays `"I have one more thing."`
- Existing numbered list formatting still passes.
- Cleanup disabled leaves `"ten"` as `"ten"` except capitalization/punctuation behavior already expected in disabled mode.

**Verify**: `bun run test cleanup` -> all cleanup tests pass.

### Step 4: Align formatter prompts only if needed

If tests reveal LLM formatted output often bypasses deterministic normalization,
adjust provider prompts to say common standalone quantities should use digits.
Keep this secondary; the deterministic cleanup is the contract. Do not loosen the
anti-hallucination safeguards in `src/main/providers/groq/groqLlm.ts`.

**Verify**: `bun run test formatting` -> existing formatting tests pass.

### Step 5: Full verification

**Verify**:
- `bun run test` -> all tests pass
- `bun run typecheck` -> exit 0
- `graphify update .` -> exit 0

## Test plan

- Extend `tests/unit/cleanup.test.ts` for positive and negative normalization.
- Existing list tests must keep passing; that protects against corrupting list cue
  behavior.
- Existing formatting tests must keep passing if prompts are touched.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test cleanup` exits 0
- [ ] `bun run test` exits 0
- [ ] `graphify update .` exits 0 after code changes
- [ ] Common numbers like "ten" and "twenty five percent" normalize to digits
- [ ] Idiomatic prose and numbered lists are not damaged
- [ ] No provider or dependency changes beyond optional prompt wording
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Correct normalization requires a broad natural-language number parser.
- Tests become ambiguous about whether a phrase should remain prose or become digits.
- The fix requires changing STT provider APIs.

## Maintenance notes

Keep this conservative. The best long-term path may be a user-facing formatting
preference, but this plan intentionally fixes the common English cases without a
settings migration.
