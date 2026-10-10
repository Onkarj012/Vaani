# Changelog

## 1.2.0 - 2026-08-12

### Added

- Added build identifiers and structured dictation traces for transcription quality, provider attempts, insertion attempts, and verification outcomes.
- Added a pull-request CI workflow for frozen installs, type checking, unit tests, packaging, whitespace validation, and tracked-file cleanliness on macOS.
- Added startup checks for Microphone and Accessibility access, with non-dismissible guidance when either permission is missing and recording blocked from the tray and hotkeys until access is granted.
- Added opt-in engine support for fuzzy dictionary matching, bare spoken snippet triggers, and per-app snippet scope. These options are not yet configurable in the UI.

### Changed

- Moved provider API keys to macOS Keychain, with startup migration of legacy keys and secret-free provider metadata retained in settings.
- Made long-recording transcription silence-aware, with overlapping chunks, model escalation, and timeout scaling based on chunk count.
- Applied dictionary corrections before transcript formatting so formatters receive the intended spelling.
- Preserved credential metadata during settings updates and dictionary rule metadata during unrelated edits.

### Fixed

- Hardened IPC validation and authorization, Keychain key updates and deletion, packaged native-addon loading, media permissions, window navigation, and local JSON file permissions.
- Fixed insertion verification so only a literal occurrence-count increase over a readable pre-insertion baseline passes, including fallback targets and partial-suffix repair.
- Excluded unreadable pre-insertion baselines from insertion acceptance denominators and per-app buckets.
- Reported denied microphone access as a permission failure instead of misclassifying it as no speech.
- Scaled long-recording deadlines and classified transcription deadline failures as timeouts.

### Validation

- `bun run test -- tests/unit/dictation.test.ts tests/unit/insertionAcceptance.test.ts tests/unit/dictationTraceStore.test.ts` passed.
- Focused permission, hotkey, dictation, insertion, and trace tests passed: `bun run test -- tests/unit/permissionGuard.test.ts tests/unit/hotkeys.test.ts tests/unit/dictation.test.ts tests/unit/insertionAcceptance.test.ts tests/unit/dictationTraceStore.test.ts`.
- `bun run typecheck` passed.

## 1.1.0 - 2026-06-12

### Added

- Improved onboarding with clearer setup flow for provider/API configuration, spoken language selection, and macOS permissions.
- Added stronger transcription language guidance so multilingual speech is preserved instead of being translated or forced into English.
- Added cached update notifications so update status is available after the renderer reconnects.

### Changed

- Bumped the app version to `1.1.0`.
- Improved auto-update messaging for development and packaged builds.
- Improved local Whisper language handling for auto-detect and Hinglish.

### Fixed

- Fixed multilingual paste corruption by using UTF-8-safe clipboard reads/writes for non-ASCII text.
- Fixed permission refresh behavior so already-granted Accessibility permission can re-register hotkeys without repeatedly asking the user to restart.
- Fixed settings persistence ordering and logging so rapid updates do not write stale settings to disk silently.
- Fixed JSON temp-file cleanup when an atomic settings write cannot be renamed into place.
- Fixed transcription and formatting timeout cleanup when provider calls reject.
- Fixed local Whisper model loading validation and failure logging.
- Fixed overlay prompt listener cleanup to target the window that registered the listener.
- Hardened Whisper model IPC/preload validation against path traversal.

### Release Notes

- `bun run typecheck`, `bun test`, `graphify update .`, and `bun run build` passed for this release branch.
- `bun run make` still needs final DMG verification on the release machine. The previous run reached packaging but failed during DMG creation because macOS blocked `macos-alias`'s native module signature.
