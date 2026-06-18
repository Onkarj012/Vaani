# Plan 003: Make the menu bar icon open language and recent-history actions

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1547c8a..HEAD -- src/main/tray.ts src/main/index.ts src/main/store/history.ts src/main/store/settings.ts src/main/dictation.ts tests/unit`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `1547c8a`, 2026-06-17

## Why this matters

Users expect the menu bar icon to expose quick actions, not repeatedly open the
full Vaani window. Today right-click opens a menu, but left-click and mouse-up
both call `onOpen()`. The menu also lacks the requested language picker and top
10 recent dictations. This plan changes the tray interaction to make the menu bar
icon a lightweight control surface.

## Current state

- `src/main/tray.ts` builds the tray menu and handles tray clicks.
- `src/main/index.ts` creates the tray and has access to `settings`, `history`,
  and `dictation` services.
- `src/main/dictation.ts` already supports `reinjectEntry(id)` and navigation to
  history entries.

Relevant excerpts:

```ts
// src/main/tray.ts:14-18
export function createTray(
  onOpen: () => void,
  onQuit: () => void,
  onStartDictation?: () => void,
  onPasteLatest?: () => void
): TrayController {
```

```ts
// src/main/tray.ts:70-82
return Menu.buildFromTemplate([
  { label: `${statusIcon}  ${status}${offlineIndicator}`, enabled: false },
  { type: "separator" },
  { label: "Open Vaani", accelerator: "Cmd+Shift+V", click: onOpen },
  ...(onStartDictation ? [{ label: "Start Dictation", click: onStartDictation }] : []),
  ...(onPasteLatest ? [{ label: "Paste Latest", click: onPasteLatest }] : []),
```

```ts
// src/main/tray.ts:106-111
tray.on("right-click", (_event, bounds) => {
  tray.popUpContextMenu(buildMenu(currentStatus), bounds);
});

tray.on("click", () => { onOpen(); });
tray.on("mouse-up", () => { onOpen(); });
```

```ts
// src/main/dictation.ts:332-335
async reinjectEntry(id: string): Promise<void> {
  const entry = await this.history.getById(id);
  if (!entry) return;
  const result = await this.injector.inject(entry.cleanedText, this.currentInjectionTarget(entry));
```

Repo UI conventions: Keep renderer presentation in React, but this work is
Electron main-process menu construction. Do not add dependencies. Avoid changing
window lifecycle or Dock visibility except what is strictly necessary for tray
click behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Targeted tests | `bun run test tray` | tray menu tests pass |
| All tests | `bun run test` | all tests pass |
| Graph update | `graphify update .` | exits 0 after source changes |

## Scope

**In scope**:
- `src/main/tray.ts`
- `src/main/index.ts` tray creation wiring
- `tests/unit/tray.test.ts` (create)
- `plans/README.md` status row

**Out of scope**:
- Renderer Settings modal redesign
- Dock/window lifecycle refactors
- Changing hotkey behavior
- Changing history storage format

## Git workflow

- Branch: `codex/003-rework-tray-menu-history-language`
- Commit message style: `feat: add tray language and history menu`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Redesign the tray controller API around dynamic menu data

Change `createTray` to accept an options object instead of many positional
callbacks. Include:

- `openMainWindow`
- `quit`
- `startDictation`
- `pasteLatest`
- `getRecentHistory: () => Promise<Array<{ id: string; cleanedText: string }>>`
- `reinjectEntry: (id: string) => Promise<void>`
- `getLanguage: () => string`
- `setLanguage: (language: string) => void`

If changing to an object causes too much churn, keep positional args but add a
single final options object. Prefer the object for readability.

**Verify**: `bun run typecheck` -> expect errors only until `src/main/index.ts`
wiring is updated in Step 2.

### Step 2: Wire settings and history from `src/main/index.ts`

Update tray creation where `createTray` is called. Use `history.getAll()` and
slice the first 10 entries for recent history. Use `settings.get().language` and
`settings.update({ language })` for language changes. Use
`dictation.reinjectEntry(id)` for recent-history clicks.

Keep "Open Vaani", "Start Dictation", "Paste Latest", "Preferences", "About",
and "Quit" available.

**Verify**: `bun run typecheck` -> exit 0.

### Step 3: Make normal tray click show the menu

Update `tray.on("click")` and `tray.on("mouse-up")` so normal interaction opens
the tray menu instead of calling `onOpen()`. Keep a deliberate "Open Vaani" menu
item for the full UI.

Avoid double-opening the menu on platforms/events where both `click` and
`mouse-up` fire. If both are needed for macOS reliability, add a small timestamp
guard inside `tray.ts` so one physical click opens one menu.

**Verify**: `bun run typecheck` -> exit 0.

### Step 4: Add language and recent-history submenus

In `buildMenu`, add:

- A "Language" submenu with Auto-detect, English, Hindi, Hinglish, and the same
  language list currently shown in Settings.
- A "Recent History" submenu with up to 10 newest history entries. Trim labels to
  roughly 60 characters and replace line breaks with spaces.
- A disabled "No recent dictations" item when history is empty.

Clicking a recent-history item should re-inject that entry at the current cursor,
not open the full window.

**Verify**: `bun run typecheck` -> exit 0.

### Step 5: Add tray unit tests

Create `tests/unit/tray.test.ts` with Electron mocks for `Tray`, `Menu`, `app`,
and `nativeImage`. Cover:

- Left click calls `popUpContextMenu`, not `openMainWindow`.
- Menu template includes a Language submenu.
- Menu template includes at most 10 recent-history items.
- Clicking a language item calls `setLanguage` with the expected code.
- Clicking a history item calls `reinjectEntry(id)`.

Use existing mock patterns from `tests/__mocks__/electron.ts` and other unit tests.

**Verify**: `bun run test tray` -> new tests pass.

### Step 6: Full verification

**Verify**:
- `bun run test` -> all tests pass
- `bun run typecheck` -> exit 0
- `graphify update .` -> exit 0

## Test plan

- New `tests/unit/tray.test.ts` for menu click behavior, submenu composition, and
  callbacks.
- Existing hotkey and dictation tests should remain green because this plan only
  changes tray wiring.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test tray` exits 0
- [ ] `bun run test` exits 0
- [ ] `graphify update .` exits 0 after code changes
- [ ] Normal tray click opens a menu instead of the full app window
- [ ] Language submenu can update settings
- [ ] Recent History submenu shows no more than 10 entries and can re-inject one
- [ ] Dock/window lifecycle code is not refactored
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Implementing tray click behavior requires changing `showMainWindow`,
  `syncAppPresentation`, Dock visibility, or startup prewarm behavior.
- Electron's Tray event mocks become too broad and start masking real behavior.
- Recent-history injection requires changing `DictationService.reinjectEntry`.

## Maintenance notes

The tray is now a product surface. Future menu additions should stay lightweight;
deep configuration belongs in Settings. Reviewer should test with both left-click
and right-click on macOS because tray event semantics differ across platforms.
