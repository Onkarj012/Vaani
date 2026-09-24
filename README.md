# Vaani — macOS Voice Dictation

> Press a hotkey. Speak. Words appear — instantly, in any app.

Vaani is a macOS voice dictation app with multi-provider transcription and LLM formatting. Choose cloud providers or an offline-only pipeline with a working local Whisper backend. No subscription or telemetry.

## Features

- **Global Hotkey** — Start dictating from anywhere with a customizable keyboard shortcut. Toggle or push-to-talk mode.
- **Multi-Provider STT** — Transcribe with Groq Whisper, OpenAI Whisper, Deepgram Nova-2, or local whisper.cpp (offline)
- **Multi-Provider LLM Formatting** — Clean up text with Groq Llama, OpenAI GPT, Anthropic Claude, or OpenRouter
- **Offline Mode** — Always Offline restricts transcription to local Whisper and skips cloud formatting. A working native Whisper backend and model are required; see Known Limitations.
- **Smart Text Cleanup** — Removes filler words ("um", "uh", "like"), fixes punctuation, and applies AI formatting
- **Context-Aware Injection** — Detects the active app and picks the best of 5 insertion methods with per-app policies
- **Per-App Profiles** — Different provider, language, and formatting settings per application
- **Snippets & Dictionary** — Custom slash-command snippets and word replacements
- **History** — Browse and re-inject past dictations
- **Auto-Updater** — Gets the latest version automatically from GitHub Releases
- **Privacy controls** — Audio recording is optional. Always Offline keeps dictation content out of cloud transcription and formatting providers.

## System Requirements

- **macOS**: 12.0 (Monterey) or later
- **Architecture**: Apple Silicon or Intel
- **Internet**: Required for cloud transcription and formatting. Always Offline requires a working local Whisper backend and downloaded model, and disables cloud formatting.
- **Permissions**: Accessibility (global hotkeys + text injection), Microphone

## Installation

### Download

Download the latest `Vaani-x.x.x-arm64.dmg` from [Releases](https://github.com/Onkarj012/Vaani/releases), open it, and drag `Vaani.app` to your Applications folder.

> **"Vaani is damaged and can't be opened"?**
> macOS blocks unsigned apps. Notarization is configured — set `APPLE_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID` environment variables before building.
>
> **One-time workaround (no Apple Developer account):**
> ```bash
> xattr -cr /Applications/Vaani.app
> ```

### Build from Source

```bash
git clone https://github.com/Onkarj012/Vaani.git
cd Vaani

bun install
bun run make
```

The built app and DMG will be in `out/make/`.

## Setup

### 1. Provider API Keys

1. Sign up for at least one provider and get an API key:
   - [Groq](https://groq.com) (fastest, free tier available)
   - [OpenAI](https://platform.openai.com) (Whisper + GPT formatting)
   - [Deepgram](https://deepgram.com) (Nova-2 STT)
   - [Anthropic](https://anthropic.com) (Claude formatting)
   - [OpenRouter](https://openrouter.ai) (multi-model gateway)
2. Open Vaani → Settings → paste your key(s)
3. With a working local Whisper backend and downloaded model, select **Always Offline** to disable cloud transcription and formatting. Selecting **Local (whisper.cpp)** alone in Auto mode does not disable cloud formatting or failover.

Provider API keys are stored in macOS Keychain. Keys left in legacy settings are migrated to Keychain and removed from the settings file on startup.

### 2. Accessibility Permission

On first launch Vaani will prompt for Accessibility access:

1. Click **Open Settings**
2. Go to **Privacy & Security → Accessibility**
3. Enable **Vaani**
4. Restart Vaani

This is required for global hotkeys and text injection.

### 3. Microphone

Vaani requests microphone access on first use. Click **Allow**.

On every startup, Vaani checks both Microphone and Accessibility access and guides you to **System Settings** if either permission is missing. Rebuilt ad-hoc apps may need these permissions granted again.

## Usage

### Dictation

1. Press your hotkey (default: `Ctrl+Option+D`)
2. Speak
3. Release — text appears at the cursor

### Paste Latest

Press `Ctrl+Cmd+V` to re-insert your most recent dictation.

### Snippets

Type `/` followed by a snippet name while dictating to expand it.

Phase 3 also supports opt-in fuzzy dictionary matching, bare spoken snippet triggers, and per-app snippet scope in the engine. These advanced options are not yet configurable in the UI.

### Tips

- Speak at a normal pace; no need to slow down
- Keep the cursor in a text field before pressing the hotkey
- Pause briefly between sentences for better punctuation

## Configuration

Open Settings from the menu bar icon or `Cmd+,`.

| Setting | Options |
|---------|---------|
| Primary hotkey | Any key combo |
| Dictation mode | Toggle / Push-to-talk / Double-press |
| Paste latest hotkey | Any key combo |
| Transcription provider | Groq / OpenAI / Deepgram / Local (whisper.cpp) |
| Formatting provider | Groq / OpenAI / Anthropic / OpenRouter / None |
| Language | Auto-detect or specific language |
| Injection mode | Auto / Accessibility / Clipboard / Keystroke |
| Smart punctuation | On / Off |
| Remove filler words | On / Off |
| Local Whisper model | tiny.en / base.en / small.en |
| Offline mode | Auto / Always Offline / Always Online |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Option+D` (default) | Start / stop dictation |
| `Ctrl+Cmd+V` (default) | Paste latest dictation |
| `Cmd+,` | Open Settings |
| `Cmd+H` | Hide window |
| `Cmd+Q` | Quit |

## Development

### Stack

- **Electron + Vite** — app shell and build
- **React + TypeScript** — UI
- **Tailwind CSS** — styling
- **Groq SDK** — transcription
- **Node-API (C++/Obj-C)** — native macOS integration

### Project Structure

```
src/
├── main/            # Electron main process
│   ├── providers/   # Multi-provider STT + LLM engine (groq, openai, deepgram, anthropic, local, openai-compatible)
│   ├── injection/   # AX + clipboard + keystroke injection (5 strategies, per-app policies)
│   ├── store/       # Keychain credentials plus local settings, history, and traces
│   ├── native/      # C++/Obj-C native addons (hotkey, injection, audio, whisper)
│   └── text/        # Cleanup and formatting
├── renderer/        # React UI (pages, components, hooks, overlay)
├── preload/         # Secure IPC bridge
└── shared/          # Types, defaults, IPC channel names
```

### Commands

```bash
bun run dev          # dev server with hot reload
bun run make         # build + create DMG
bun run test         # unit tests
bun run typecheck    # TypeScript check
```

### Releasing

1. Bump `version` in `package.json`
2. Commit and push to `main`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. CI builds the DMG and creates a draft release — publish it on GitHub

## Privacy

- Save Recordings is off by default. Enabling it saves WAV files locally for replay.
- Cloud transcription sends audio to configured providers; cloud formatting sends transcript text. Provider retention policies apply.
- Always Offline excludes cloud STT and skips provider formatting. Auto mode can use cloud formatting and configured failover even when Local Whisper is selected.
- Failed-dictation recovery remains disabled in this build. Its future audio-retention consent and upgrade policy must be verified before enablement.
- Copied bug reports contain a limited diagnostic summary, excluding transcript text and local audio paths. Export Data remains a separate, content-bearing export of settings and history.
- Provider API keys are stored in macOS Keychain; legacy settings keys migrate there on startup
- Non-secret settings, history, and dictation traces are stored locally in `~/.vaani/`
- No telemetry or analytics

## Known Limitations

- macOS only (12+)
- Local Whisper is not yet verified as a working packaged provider. The checked-in native build uses Whisper stubs unless a real backend is supplied. Always Offline fails without a working local backend; it does not fall back to cloud.
- Very short phrases (< 3 words) may not inject reliably in some apps
- **Stale state after extended uptime** — App may become unresponsive after ~16 hours of continuous use. Restarting Vaani resolves this. Auto-recovery watchdog added in v1.0.4; root cause investigation ongoing.
- **Capsule overlay** — The recording overlay (bottom-center pill) may occasionally not appear when dictation starts. It typically reappears on the next attempt. Visibility retry logic added in v1.0.4.
- Notarization requires Apple Developer credentials. See installation workaround below.

## Roadmap

- **Persistent stale state fix** — Root cause investigation and fix for long-uptime unresponsiveness
- **Capsule reliability** — Eliminate intermittent overlay non-appearance
- **Improved offline support** — Smarter offline/online switching without user intervention
- **App profiles** — Per-app transcription settings (language, provider, auto-submit)

## Contributing

Pull requests are welcome. For major changes open an issue first.

```bash
# fork → clone → branch
git checkout -b feat/your-feature

# make changes, then
bun run test && bun run typecheck

# push and open a PR against main
```

Keep PRs focused — one feature or fix per PR.

## License

MIT — see [LICENSE](LICENSE)

## Credits

- Transcription by [Groq](https://groq.com), [OpenAI](https://openai.com), [Deepgram](https://deepgram.com), and [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- LLM formatting by Groq, OpenAI, Anthropic, and [OpenRouter](https://openrouter.ai)
- Built with [Electron](https://electronjs.org) and [React](https://react.dev)
