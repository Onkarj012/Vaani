# Plan 003: Add CSP to main and overlay renderer entries

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report instead of improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e87a3af..HEAD -- src/renderer/index.html src/renderer/overlay/index.html src/renderer/recorder/index.html src/renderer/main.tsx src/renderer/styles src/renderer/context`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e87a3af`, 2026-06-16

## Why this matters

Electron renderer compromise is higher impact than ordinary web UI compromise because preload exposes privileged app actions over IPC. The recorder renderer already has a restrictive CSP, but the main and overlay renderers do not. Adding CSP and removing inline script reduces the blast radius of renderer injection and dependency compromise.

## Current state

- `src/renderer/index.html:8-14` loads remote font CSS from Fontshare and Google Fonts.
- `src/renderer/index.html:15-17` contains an inline script that reads `localStorage` and adds the `dark` class.
- `src/renderer/overlay/index.html` has no CSP meta tag.
- `src/renderer/recorder/index.html:5` already uses: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; connect-src 'self' blob:;`

Repo conventions to match:

- Renderer code is React + Vite + TypeScript.
- Do not add new dependencies.
- Preserve visual behavior, including dark-mode bootstrap.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Tests | `bun test` | all pass |
| Build smoke | `bun run build` | exits 0 and packages locally |

## Scope

**In scope**:
- `src/renderer/index.html`
- `src/renderer/overlay/index.html`
- Renderer bootstrap code needed to remove inline script
- Optional local font asset/config changes only if necessary

**Out of scope**:
- Changing preload permissions.
- Reworking app design or fonts beyond what CSP requires.
- Adding external font packages without approval.

## Git workflow

- Branch suggestion: `advisor/003-renderer-csp`
- Commit message example: `fix: add renderer content security policy`

## Steps

### Step 1: Move the inline dark-mode bootstrap out of HTML

Remove the inline script in `src/renderer/index.html`. Recreate the behavior in bundled renderer code, ideally before React paints if possible. If a flash occurs and cannot be avoided without inline script, STOP and propose either a CSP nonce/hash approach or a small local bootstrap file.

**Verify**: `bun run typecheck` -> exits 0.

### Step 2: Add CSP meta tags

Add CSP meta tags to main and overlay HTML entries. Start from the recorder CSP and only add the minimum needed sources. If remote fonts remain, explicitly allow the needed `style-src`/`font-src` endpoints. Prefer bundled/self-hosted fonts if already available.

**Verify**: `bun run typecheck` -> exits 0.

### Step 3: Check development and packaged behavior

Run a build smoke. If Vite dev requires different CSP than packaged mode, use a policy that works for both without weakening packaged production more than necessary.

**Verify**: `bun run build` -> exits 0. If local signing/notarization environment prevents package completion, record the exact failure and still run `bun run typecheck && bun test`.

## Test plan

- Existing unit tests should still pass.
- Manual/browser smoke if available: open the app in dev and confirm main UI and overlay render without CSP violations in console.

## Done criteria

- [ ] Main renderer has a CSP meta tag.
- [ ] Overlay renderer has a CSP meta tag.
- [ ] Inline script is removed or explicitly justified with a safe CSP hash/nonce approach.
- [ ] `bun test` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run build` exits 0 or a documented environment-only blocker is reported.

## STOP conditions

- CSP breaks Vite/Electron loading in a way that requires broad `default-src *`.
- Fixing CSP requires changing preload IPC surface.
- Local font handling requires adding dependencies or large binary assets without approval.

## Maintenance notes

When adding new renderer features, update CSP deliberately. Do not add broad sources such as `unsafe-eval` or wildcard network access without a documented reason.
