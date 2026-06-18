# Changelog

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
