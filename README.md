# Vaani — macOS Voice Dictation

> Press a hotkey. Speak. Words appear — instantly, in any app.

Vaani is a fast, privacy-first voice dictation app for macOS with multi-provider transcription and LLM formatting. Choose from Groq, OpenAI, Deepgram, Anthropic, or run entirely offline with local Whisper. No subscription, no cloud storage, no telemetry.

## Features

- **Global Hotkey** — Start dictating from anywhere with a customizable keyboard shortcut. Toggle or push-to-talk mode.
- **Multi-Provider STT** — Transcribe with Groq Whisper, OpenAI Whisper, Deepgram Nova-2, or local whisper.cpp (offline)
- **Multi-Provider LLM Formatting** — Clean up text with Groq Llama, OpenAI GPT, Anthropic Claude, or OpenRouter
- **Offline Mode** — Built-in whisper.cpp runs entirely on-device — no internet, no API keys needed
- **Smart Text Cleanup** — Removes filler words ("um", "uh", "like"), fixes punctuation, and applies AI formatting
- **Context-Aware Injection** — Detects the active app and picks the best of 5 insertion methods with per-app policies
- **Per-App Profiles** — Different provider, language, and formatting settings per application
- **Snippets & Dictionary** — Custom slash-command snippets and word replacements
- **History** — Browse and re-inject past dictations
- **Auto-Updater** — Gets the latest version automatically from GitHub Releases
- **Privacy-First** — Audio is transient; nothing stored on any server. Local mode keeps everything on-device.

## System Requirements

- **macOS**: 12.0 (Monterey) or later
- **Architecture**: Apple Silicon or Intel
- **Internet**: Required for transcription (Groq API)
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
3. Or skip cloud entirely — select **Local (whisper.cpp)** for offline transcription

### 2. Accessibility Permission

On first launch Vaani will prompt for Accessibility access:

1. Click **Open Settings**
2. Go to **Privacy & Security → Accessibility**
3. Enable **Vaani**
4. Restart Vaani

This is required for global hotkeys and text injection.

### 3. Microphone

Vaani requests microphone access on first use. Click **Allow**.

## Usage

### Dictation

1. Press your hotkey (default: `Ctrl+Option+D`)
2. Speak
3. Release — text appears at the cursor

### Paste Latest

Press `Ctrl+Cmd+V` to re-insert your most recent dictation.

### Snippets

Type `/` followed by a snippet name while dictating to expand it.

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
│   ├── store/       # Settings & history (JSON, ~/.vaani/)
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
bun test             # unit tests
bun run typecheck    # TypeScript check
```

### Releasing

1. Bump `version` in `package.json`
2. Commit and push to `main`
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. CI builds the DMG and creates a draft release — publish it on GitHub

## Privacy

- Audio is never stored locally or on any server
- Audio is sent directly to Groq's API; their [privacy policy](https://groq.com/privacy) applies
- Settings and history are stored locally in `~/.vaani/`
- No telemetry or analytics

## Known Limitations

- macOS only (12+)
- Cloud providers require internet; local whisper.cpp works fully offline
- Very short phrases (< 3 words) may not inject reliably in some apps
- **Stale state after extended uptime** — App may become unresponsive after ~16 hours of continuous use. Restarting Vaani resolves this. Auto-recovery watchdog added in v1.0.4; root cause investigation ongoing.
- **Capsule overlay** — The recording overlay (bottom-center pill) may occasionally not appear when dictation starts. It typically reappears on the next attempt. Visibility retry logic added in v1.0.4.
- API keys are stored in plain JSON on disk. Keychain integration is planned for v1.1.
- Notarization requires Apple Developer credentials. See installation workaround below.

## Roadmap (v1.1+)

- **macOS Keychain integration** — Secure API key storage replacing plain JSON
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
bun test && bun run typecheck

# push and open a PR against main
```

Keep PRs focused — one feature or fix per PR.

## License

MIT — see [LICENSE](LICENSE)

## Credits

- Transcription by [Groq](https://groq.com), [OpenAI](https://openai.com), [Deepgram](https://deepgram.com), and [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- LLM formatting by Groq, OpenAI, Anthropic, and [OpenRouter](https://openrouter.ai)
- Built with [Electron](https://electronjs.org) and [React](https://react.dev)
