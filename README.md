# Vaani — macOS Voice Dictation

> Press a hotkey. Speak. Words appear — instantly, in any app.

Vaani is a fast, privacy-first voice dictation app for macOS powered by [Groq's Whisper API](https://groq.com). No subscription, no cloud storage, no telemetry.

## Features

- **Global Hotkey** — Start dictating from anywhere with a customizable keyboard shortcut
- **Fast Transcription** — Powered by Groq's Whisper API for near-instant results
- **Smart Text Cleanup** — Removes filler words ("um", "uh", "like") and fixes punctuation
- **Context-Aware Injection** — Detects the active app and picks the best insertion method
- **Multiple Injection Methods** — Accessibility APIs, clipboard, or keystroke simulation
- **Snippets & Dictionary** — Custom slash-command snippets and word replacements
- **History** — Browse and re-inject past dictations
- **Auto-Updater** — Gets the latest version automatically from GitHub Releases
- **Privacy-First** — Audio goes directly to Groq's API; nothing stored on any server

## System Requirements

- **macOS**: 12.0 (Monterey) or later
- **Architecture**: Apple Silicon or Intel
- **Internet**: Required for transcription (Groq API)
- **Permissions**: Accessibility (global hotkeys + text injection), Microphone

## Installation

### Download

Download the latest `Vaani-x.x.x-arm64.dmg` from [Releases](https://github.com/Onkarj012/Vaani/releases), open it, and drag `Vaani.app` to your Applications folder.

### Build from Source

```bash
git clone https://github.com/Onkarj012/Vaani.git
cd Vaani

bun install
bun run make
```

The built app and DMG will be in `out/make/`.

## Setup

### 1. Groq API Key

1. Sign up at [groq.com](https://groq.com) and get an API key
2. Open Vaani → Settings → paste your key

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
| Paste latest hotkey | Any key combo |
| Language | Auto-detect or specific language |
| Injection mode | Auto / Accessibility / Clipboard |
| Smart punctuation | On / Off |
| Remove filler words | On / Off |

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
├── main/          # Electron main process (dictation, injection, overlay, tray)
│   ├── injection/ # AX + clipboard injection strategies
│   ├── store/     # Settings & history (JSON, ~/.vaani/)
│   └── text/      # Cleanup and formatting
├── renderer/      # React UI (pages, components, hooks)
├── preload/       # Secure IPC bridge
└── shared/        # Types, defaults, IPC channel names
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
- Requires internet for transcription
- Very short phrases (< 3 words) may not inject reliably in some apps

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

- Transcription by [Groq](https://groq.com) / OpenAI Whisper
- Built with [Electron](https://electronjs.org) and [React](https://react.dev)
