# Plan 002: Make recorder input selection reject virtual loopback devices

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If
> anything in the "STOP conditions" section occurs, stop and report; do not
> improvise. When done, update the status row for this plan in `plans/README.md`
> unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1547c8a..HEAD -- src/renderer/recorder/main.ts src/renderer/hooks/useAudioRecorder.ts src/renderer/components/SettingsModal.tsx src/shared/types.ts src/shared/defaults.ts tests/unit`
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

Users report that Vaani picks up background audio playing from the computer when
they stop speaking. The active recorder does use microphone capture, not screen
or system capture, but its device selection falls back to the first non-default
input. On machines with BlackHole, Loopback, aggregate devices, display audio, or
other virtual inputs, that fallback can choose a device that includes system
audio. A separate, currently unused hook already contains a better virtual-device
filter; this plan moves that behavior into the active recorder path and makes the
UI honest about what is selected.

## Current state

- `src/renderer/recorder/main.ts` is the active hidden recorder window. It handles
  `StartRecording`/`StopRecording` IPC and calls `navigator.mediaDevices.getUserMedia`.
- `src/renderer/hooks/useAudioRecorder.ts` is not the active recorder path for
  dictation. It contains a stronger virtual-device filter that should be reused
  or mirrored.
- `src/renderer/components/SettingsModal.tsx` currently displays a static
  "System Default Microphone" row; users cannot inspect or choose the real input.

Relevant excerpts:

```ts
// src/renderer/recorder/main.ts:55-64
const micDeviceId = await chooseMicDevice();
stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    ...(micDeviceId ? { deviceId: micDeviceId } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false
  }
});
```

```ts
// src/renderer/recorder/main.ts:159-169
async function chooseMicDevice(): Promise<ConstrainDOMString | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(
      device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications"
    );
    const builtIn = inputs.find(device => {
      const label = device.label.toLowerCase();
      return label.includes("built-in") || label.includes("macbook") || label.includes("internal");
    }) ?? inputs[0];
    return builtIn?.deviceId ? { exact: builtIn.deviceId } : undefined;
```

```ts
// src/renderer/hooks/useAudioRecorder.ts:170-189
const VIRTUAL_PATTERNS = ["blackhole", "loopback", "multi-output", "virtual", "soundflower", "display audio", "aggregate"];
const physicalMics = inputs.filter(d => {
  const label = d.label.toLowerCase();
  return !VIRTUAL_PATTERNS.some(p => label.includes(p));
});
const builtInMic = physicalMics.find(d => {
  const label = d.label.toLowerCase();
  return label.includes("built-in") || label.includes("macbook") || label.includes("internal");
});
const chosen = builtInMic ?? physicalMics[0];
```

```tsx
// src/renderer/components/SettingsModal.tsx:275-279
<div className="flex items-center gap-3">
  <Mic size={16} className="text-muted" />
  <div><div className="text-sm text-ink">System Default Microphone</div><div className="text-xs text-faint">Vaani uses your system mic</div></div>
</div>
```

Repo conventions: renderer logic should live in hooks/helpers, not large
components. Reuse TypeScript types from `src/shared/types.ts`; no new
dependencies.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Targeted tests | `bun run test recorder` | new recorder-device tests pass |
| All tests | `bun run test` | all tests pass |
| Graph update | `graphify update .` | exits 0 after source changes |

## Scope

**In scope**:
- `src/renderer/recorder/main.ts`
- A small shared helper for recorder device selection, preferably under `src/renderer/recorder/`
- `tests/unit/recorderDeviceSelection.test.ts` (create)
- `src/shared/types.ts` and `src/shared/defaults.ts` only if adding a persisted microphone setting
- `src/renderer/components/SettingsModal.tsx` only for an honest microphone row or selector
- `plans/README.md` status row

**Out of scope**:
- Native CoreAudio routing in `src/native/accessibility/injector.mm`
- Transcription provider changes
- Audio VAD tuning in `src/main/audio/vad.ts`
- Adding dependencies

## Git workflow

- Branch: `codex/002-harden-microphone-input-selection`
- Commit message style: `fix: avoid virtual loopback devices for recording`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extract testable recorder device selection

Move the logic from `chooseMicDevice()` into a pure helper that accepts an array
of `MediaDeviceInfo`-like objects and returns the chosen device ID or `undefined`.
Keep the active `chooseMicDevice()` wrapper in `src/renderer/recorder/main.ts`;
it should enumerate devices and call the helper.

The helper should:

- Exclude `default` and `communications` pseudo-devices.
- Exclude virtual/loopback labels: `blackhole`, `loopback`, `multi-output`,
  `virtual`, `soundflower`, `display audio`, `aggregate`, `obs`, `zoom audio`,
  `teams audio`, and `screen`.
- Prefer built-in/internal/MacBook microphones.
- Prefer physical-looking devices over virtual devices.
- Return `undefined` only when no acceptable physical microphone exists, allowing
  `getUserMedia({ audio: ... })` to fall back to browser/system default.

**Verify**: `bun run typecheck` -> exit 0.

### Step 2: Add unit tests for the selection matrix

Create `tests/unit/recorderDeviceSelection.test.ts`. Cover:

- Built-in microphone beats virtual devices and external microphones.
- A virtual input named "BlackHole 2ch" is never selected.
- A virtual input named "Loopback Audio" is never selected.
- With no built-in mic, the first non-virtual physical input is selected.
- With only virtual inputs, the helper returns `undefined`.
- Empty labels do not crash and are treated conservatively.

Use plain objects typed as `Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">`
if DOM types make direct construction awkward.

**Verify**: `bun run test recorder` -> new tests pass.

### Step 3: Wire the helper into the active recorder

Update `src/renderer/recorder/main.ts` so `chooseMicDevice()` uses the helper.
Do not alter `MediaRecorder`, visualizer, resampling, tail capture, or IPC
session behavior.

**Verify**:
- `bun run typecheck` -> exit 0
- `bun run test recorder` -> pass

### Step 4: Make the Settings audio/mic copy honest

In `src/renderer/components/SettingsModal.tsx`, replace the static "System
Default Microphone" text with copy that matches the behavior, such as
"Automatic Microphone" and "Prefers built-in/physical mics and skips virtual
loopback inputs." If you add a user-selectable microphone setting, keep it scoped
to selection only and test it; otherwise keep this as copy only.

**Verify**: `bun run typecheck` -> exit 0.

### Step 5: Full verification

**Verify**:
- `bun run test` -> all tests pass
- `bun run typecheck` -> exit 0
- `graphify update .` -> exit 0

## Test plan

- New `tests/unit/recorderDeviceSelection.test.ts` for the pure selection helper.
- Existing recorder behavior remains covered by typecheck and integration through
  the hidden recorder window code.
- No real microphone access should be required in tests.

## Done criteria

ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test recorder` exits 0
- [ ] `bun run test` exits 0
- [ ] `graphify update .` exits 0 after code changes
- [ ] Active `src/renderer/recorder/main.ts` excludes common virtual/loopback inputs
- [ ] Settings UI no longer claims Vaani simply uses "System Default Microphone"
- [ ] No native audio routing files are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `src/renderer/recorder/main.ts` is no longer the active recorder path.
- The fix requires changing CoreAudio default-device switching.
- Tests would need real `navigator.mediaDevices` hardware access.
- The user-selectable microphone feature expands into a broad settings/storage refactor.

## Maintenance notes

This plan reduces system-audio contamination from virtual inputs; it cannot fully
remove acoustic speaker bleed when laptop speakers are physically audible to the
microphone. Future work can add a visible input meter and microphone selector, but
that should be a separate product plan if it grows beyond this scoped fix.
