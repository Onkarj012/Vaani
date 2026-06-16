# Plan 004: Serialize history store writes

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- src/main/store/history.ts src/main/store/base.ts tests/unit`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

History mutations use read-modify-write against a JSON file. If two mutations overlap, the later write can be based on stale data and lose a completed dictation, undo a delete, or overwrite an edit. This is a small store-level fix with a clear test story.

## Current state

- `src/main/store/history.ts:19-22` reads all history, prepends, then writes.
- `src/main/store/history.ts:25-27` reads all history, filters, then writes.
- `src/main/store/history.ts:30-31` writes an empty array.
- `src/main/store/history.ts:44-61` reads all history, maps one entry, then writes.
- `src/main/store/settings.ts` already uses a `pendingWrite` promise queue pattern for settings persistence.

Repo conventions to match:

- Stores live in `src/main/store/*`.
- JSON persistence helpers are in `src/main/store/base.ts`.
- Unit tests use Vitest under `tests/unit/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `bun test -- tests/unit/<history-test>.test.ts` | new tests pass |
| Full tests | `bun test` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `src/main/store/history.ts`
- New tests under `tests/unit/`

**Out of scope**:
- Pagination/indexed history APIs. That is a separate performance plan.
- Changing the history file format.
- Changing renderer history UI.

## Git workflow

- Branch suggestion: `advisor/004-serialize-history-writes`
- Commit message example: `fix: serialize history store writes`

## Steps

### Step 1: Add a mutation queue

In `HistoryStore`, add a private promise queue similar to `SettingsStore.pendingWrite`. Route `append`, `delete`, `clear`, and `updateById` through that queue so each mutation reads the latest file state after prior mutations finish.

**Verify**: `bun run typecheck` -> exits 0.

### Step 2: Preserve read behavior

Keep `getAll`, `getById`, and `getLatest` read-only. If a read must observe pending writes for correctness, document that decision and test it. Do not change `normalizeHistory` output shape.

**Verify**: `bun run typecheck` -> exits 0.

### Step 3: Add concurrency regression tests

Add a unit test that creates a `HistoryStore` with a temp file path, fires overlapping `append` calls, awaits them, and confirms both entries exist in expected order. Add another overlapping append/delete or update test if easy.

**Verify**: focused test command -> passes.

## Test plan

- Concurrent appends do not lose entries.
- Concurrent append plus update/delete behaves deterministically according to queue order.
- Existing normalization behavior remains unchanged.

Use temporary files under the test temp directory and avoid touching the user's real `~/.vaani/`.

## Done criteria

- [ ] Mutating history operations are serialized.
- [ ] Concurrent mutation regression test exists and passes.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] No history file format migration is introduced.

## STOP conditions

- The fix appears to require changing renderer APIs.
- Tests would need to touch real user history paths.
- Queueing causes deadlock or unresolved promises in a simple append test.

## Maintenance notes

This plan makes current JSON persistence safer. It does not solve full-file I/O or renderer recomputation at high history counts; keep that as a later pagination/indexing plan.
