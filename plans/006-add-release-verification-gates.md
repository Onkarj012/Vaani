# Plan 006: Run verification before release packaging

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- .github/workflows/release.yml package.json bun.lockb package-lock.json`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

The release workflow builds distributables and creates draft releases without first running TypeScript or unit tests. A tagged release can therefore package broken code. Adding verification gates before packaging is low risk and improves confidence for every later plan.

## Current state

- `package.json` defines `typecheck` as `tsc --noEmit`.
- `package.json` defines `test` as `vitest run`.
- `.github/workflows/release.yml:25-35` installs dependencies, builds native code, makes distributables, and generates update metadata.
- No release step currently runs `npm run typecheck`, `npm test`, `bun run typecheck`, or `bun test`.

Repo conventions:

- User-facing repo docs prefer Bun commands.
- Existing package scripts call npm internally for native build/package commands. Do not remove the native build step.
- The workflow currently uses Node 20 and `npm install`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `bun test` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Workflow syntax review | inspect `.github/workflows/release.yml` | valid YAML |

## Scope

**In scope**:
- `.github/workflows/release.yml`
- `package.json` only if a script alias is necessary

**Out of scope**:
- Removing or bypassing `build:native`.
- Migrating the entire workflow from npm to Bun unless the operator explicitly wants package-manager standardization.
- Publishing GitHub issues or changing release permissions.

## Git workflow

- Branch suggestion: `advisor/006-release-verification`
- Commit message example: `ci: run tests before release packaging`

## Steps

### Step 1: Add typecheck and test steps before packaging

In `.github/workflows/release.yml`, add explicit steps after dependency install and before `Build native module` or `Make distributables`:
- Run the TypeScript check.
- Run the Vitest suite.

Use npm equivalents if keeping the workflow npm-based: `npm run typecheck` and `npm test`. Use Bun only if the workflow also installs/sets up Bun consistently.

**Verify**: inspect YAML and run local `bun run typecheck && bun test` -> both exit 0.

### Step 2: Avoid duplicate native builds if possible

The current workflow runs `npm run build:native`, then `npm run make`; `make` already runs `npm run build:native` through the package script. Do not remove the native build step unless you confirm the package script still performs it. If you leave duplication in place, add no comment unless needed.

**Verify**: `package.json` still has `make` or workflow still has an explicit native build before packaging.

### Step 3: Consider a PR workflow only if scoped

If adding a lightweight PR workflow is acceptable within this plan, add `.github/workflows/ci.yml` with checkout, setup, install, typecheck, and test. If this would require package-manager decisions, skip it and leave a note in `plans/README.md`.

**Verify**: YAML is valid and commands match `package.json`.

## Test plan

- Local: `bun run typecheck` and `bun test`.
- Review: confirm release workflow cannot reach `electron-forge make` unless verification steps pass.

## Done criteria

- [ ] Release workflow runs typecheck before packaging.
- [ ] Release workflow runs unit tests before packaging.
- [ ] Native build remains part of release packaging.
- [ ] Local `bun run typecheck` exits 0.
- [ ] Local `bun test` exits 0.

## STOP conditions

- Local tests/typecheck fail for unrelated pre-existing reasons.
- Workflow change requires choosing between npm and Bun beyond adding verification commands.
- Native build step would be removed or skipped.

## Maintenance notes

If the repo later standardizes on Bun in CI, update release and PR workflows together. Keep verification before artifact upload and release creation.
