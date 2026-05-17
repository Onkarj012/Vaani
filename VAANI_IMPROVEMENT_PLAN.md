# Vaani Improvement Plan — Beyond TypeWhisper

**Goal:** Make Vaani on par with or better than any macOS dictation alternative.  
**Current:** v1.0.3 — Groq-only dictation, Electron + React, excellent injection system.  
**Target:** Multi-provider voice AI platform with plugin ecosystem, offline capability, and developer API.

---

## Table of Contents

1. [Phase 0: Foundation Hardening (1-2 weeks)](#phase-0-foundation-hardening-1-2-weeks)
2. [Phase 1: Multi-Provider Engine (2-3 weeks)](#phase-1-multi-provider-engine-2-3-weeks)
3. [Phase 2: Offline & Local (3-4 weeks)](#phase-2-offline--local-3-4-weeks)
4. [Phase 3: Power User Features (2-3 weeks)](#phase-3-power-user-features-2-3-weeks)
5. [Phase 4: Developer Platform (3-4 weeks)](#phase-4-developer-platform-3-4-weeks)
6. [Phase 5: Polish & Distribution (2-3 weeks)](#phase-5-polish--distribution-2-3-weeks)
7. [Architecture Decisions](#architecture-decisions)
8. [File Change Map](#file-change-map)

---

## Phase 0: Foundation Hardening (1-2 weeks)

These are low-risk, high-impact improvements that don't require architectural changes.

### 0.1 — Audio recording to disk

**What:** Save dictation audio as WAV files for replay, sharing, and re-transcription.

**Why:** TypeWhisper, MacWhisper, and Superwhisper all support this. Missing from Vaani.

**Implementation:**
- In `src/main/dictation.ts`, after `submitAudioClip()`, save the WAV buffer to `~/Documents/Vaani Recordings/` (configurable)
- Add a `saveRecordings?: boolean` setting in `Settings` type
- WAV buffer already exists in `createWavBuffer()` in `transcription.ts` — extract it into a shared utility
- Add a "Save recording" toggle in Settings

**Files touched:** `src/shared/types.ts`, `src/main/transcription.ts`, `src/main/dictation.ts`, Settings UI

### 0.2 — Push-to-talk hotkey mode

**What:** Hold-to-record (push-to-talk), not just toggle and double-press toggle.

**Why:** TypeWhisper and competitors support all three modes. Many users prefer PTT.

**Implementation:**
- The native `hotkey_monitor.mm` already supports press/release callbacks
- The `HotkeyManager` already has `onPress`/`onRelease` and double-press logic
- Add `dictationMode: "toggle" | "push-to-talk" | "toggle-double"` to `Settings`
- In PTT mode: `handlePress()` calls `onPress()` (start), `handleRelease()` calls `onRelease()` (stop) immediately — skip double-press logic entirely
- Remove the 300ms min-hold for PTT mode

**Files touched:** `src/shared/types.ts`, `src/shared/defaults.ts`, `src/main/hotkeys.ts`, Settings UI

### 0.3 — Keychain storage for API keys

**What:** Store the Groq API key (and future provider keys) in the macOS Keychain.

**Why:** TypeWhisper uses `KeychainService.swift`. Vaani currently stores the key in plain JSON (`~/.vaani/settings.json`). This is a security risk.

**Implementation:**
- Add `keytar` package (mature, well-maintained Electron keychain library)
  - Alternative: native module via `security` framework in `injector.mm`
- Create `src/main/store/credentials.ts` with `getCredential(key)`, `setCredential(key, value)`, `deleteCredential(key)`
- Add `migrateFromSettings(settings)` — on first launch, moves existing API keys from settings.json to Keychain
- Update `TranscriptionService` to call `credentials.get("groq_api_key")` instead of `settings.groqApiKey`

**Files touched:** `src/main/store/credentials.ts` (new), `src/main/transcription.ts`, `src/main/dictation.ts`, `package.json`

### 0.4 — Fn key modifier improvements

**What:** Better detection and UX for Fn-key hotkeys.

**Why:** The native module handles Fn but there's a known CGEvent limitation. Add a settings hint and fallback behavior.

**Implementation:**
- In `hotkey_monitor.mm`, log whether Fn detection is working on this hardware
- In Settings UI, add a notice when Fn is selected: "Fn key detection is hardware-dependent. Test your hotkey before relying on it."
- Add a "Didn't trigger?" self-test button in hotkey settings

**Files touched:** `src/native/hotkeys/hotkey_monitor.mm`, Settings UI

---

## Phase 1: Multi-Provider Engine (2-3 weeks)

This is the single biggest leap — Vaani's biggest limitation is being Groq-only.

### 1.1 — Provider abstraction layer

**What:** Abstract transcription and formatting behind provider interfaces so any backend can be plugged in.

**Why:** TypeWhisper has 17 transcription engines. Vaani has 1. This fixes the #1 competitive gap.

**Architecture:**

```
src/main/providers/
├── types.ts              # TranscriptionProvider, FormattingProvider interfaces
├── registry.ts           # ProviderRegistry — discover, register, select providers
├── groq/
│   ├── groqStt.ts         # Groq Whisper transcription
│   └── groqLlm.ts         # Groq Llama formatting (existing, refactored)
├── openai/
│   ├── openaiStt.ts       # OpenAI Whisper transcription
│   └── openaiLlm.ts       # GPT-4o-mini formatting
├── anthropic/
│   └── anthropicLlm.ts    # Claude Haiku formatting
├── deepgram/
│   └── deepgramStt.ts     # Deepgram Nova-2 transcription
├── gemini/
│   └── geminiStt.ts       # Google Gemini STT
├── local/
│   └── whisperCpp.ts      # Local whisper.cpp (Phase 2)
└── openai-compatible/
    └── openAiCompatible.ts # Any OpenAI-compatible endpoint
```

**Provider interface:**

```typescript
// src/main/providers/types.ts
export interface TranscriptionProvider {
  id: string;
  name: string;
  requiresApiKey: boolean;
  models: { id: string; name: string; languages: string[] }[];
  transcribe(clip: AudioClip, options: TranscriptionOptions): Promise<TranscriptionResult>;
  isAvailable(): boolean;
}

export interface FormattingProvider {
  id: string;
  name: string;
  requiresApiKey: boolean;
  format(rawText: string, options: FormattingOptions): Promise<string>;
  isAvailable(): boolean;
}

export interface TranscriptionOptions {
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
}

export interface FormattingOptions {
  model?: string;
  style?: "default" | "strict" | "casual";
  systemPrompt?: string;
}
```

**Provider registry:**

```typescript
// src/main/providers/registry.ts
export class ProviderRegistry {
  private transcriptionProviders = new Map<string, TranscriptionProvider>();
  private formattingProviders = new Map<string, FormattingProvider>();
  
  registerTranscription(provider: TranscriptionProvider): void;
  registerFormatting(provider: FormattingProvider): void;
  
  getActiveTranscription(): TranscriptionProvider;  // from settings
  getActiveFormatting(): FormattingProvider;         // from settings
  
  listTranscriptionProviders(): TranscriptionProvider[];
  listFormattingProviders(): FormattingProvider[];
}
```

**Implementation:**
1. Create the interfaces and registry
2. Refactor existing `TranscriptionService` into a Groq provider
3. Refactor existing `formatTranscript()` into a Groq formatting provider
4. Add OpenAI STT provider (same SDK pattern, just different endpoint)
5. Add Deepgram provider (npm: `@deepgram/sdk`)
6. Add OpenAI LLM provider for formatting (GPT-4o-mini)
7. Update `Settings` to include `transcriptionProvider: string`, `formattingProvider: string`, per-provider API keys
8. Update `DictationService` to use registry instead of hard-coded `TranscriptionService`

**Files touched:** 
- New: `src/main/providers/types.ts`, `src/main/providers/registry.ts`, `src/main/providers/groq/groqStt.ts`, `src/main/providers/groq/groqLlm.ts`, `src/main/providers/openai/openaiStt.ts`, `src/main/providers/openai/openaiLlm.ts`, `src/main/providers/anthropic/anthropicLlm.ts`, `src/main/providers/deepgram/deepgramStt.ts`, `src/main/providers/openai-compatible/openAiCompatible.ts`
- Modified: `src/main/dictation.ts`, `src/main/transcription.ts` (→ deprecated/redirected), `src/main/formatting.ts` (→ deprecated/redirected), `src/shared/types.ts`, `src/shared/defaults.ts`, `package.json`

### 1.2 — Provider settings UI

**What:** Let users select and configure providers from the Settings page.

**What to build:**
- Dropdown for "Transcription Provider" (Groq, OpenAI, Deepgram, Local)
- Dropdown for "Formatting Provider" (Groq, OpenAI, Anthropic)
- Per-provider API key inputs
- Per-provider model selection
- Connection test button ("Test API key")
- Latency indicator

**Files touched:** Settings UI components

### 1.3 — Provider auto-failover

**What:** If primary provider fails (rate limit, timeout), automatically try the next configured provider.

**Implementation:**
- In `ProviderRegistry`, maintain an ordered list of configured providers
- On transcription failure, try the next provider in the list
- Log the failover event
- Show a subtle notification "Switched to OpenAI (Groq timed out)"
- Don't fail over for auth errors (bad API key)

**Files touched:** `src/main/providers/registry.ts`, `src/main/dictation.ts`

---

## Phase 2: Offline & Local (3-4 weeks)

### 2.1 — whisper.cpp integration

**What:** On-device Whisper transcription via whisper.cpp — no internet, no API keys, no data leaving the machine.

**Why:** TypeWhisper's #1 competitive advantage is 6 offline engines. This closes that gap entirely.

**Approach A (recommended): Native addon with whisper.cpp**
- Add `whisper.cpp` as a git submodule or vendored dependency
- Create `src/native/whisper/whisper_engine.mm` that wraps whisper.cpp in a Node-API module
- Pre-build whisper.cpp with CoreML support (Apple Silicon GPU acceleration)
- Bundle whisper.cpp binary in the app's extra resources
- Ship a base model (tiny.en, ~78MB) with the app, offer larger models as downloads

**Approach B (lighter weight): whisper-node**
- Use `whisper-node` npm package (wraps whisper.cpp with prebuilt binaries)
- Simpler integration but less control
- May have version lag

**Implementation (Approach A):**

```
src/native/whisper/
├── whisper_engine.mm       # Node-API wrapper for whisper.cpp
├── whisper_engine.h         # Header
├── model_manager.mm         # Download/manage Whisper models
├── model_manager.h
└── whisper_cpp/             # Vendored whisper.cpp (git submodule)
```

**Key native exports:**
```c
bool WhisperLoadModel(const char* modelPath);        // Load a GGML model
bool WhisperTranscribe(const float* pcmData, int nSamples, char* output, int maxLen);
bool WhisperIsModelLoaded();
void WhisperFreeModel();
char** WhisperListModels(const char* modelsDir);     // Discover downloaded models
```

**Settings additions:**
- `transcriptionProvider: "local"`  
- `localWhisperModel: "tiny.en" | "base.en" | "small.en" | "medium.en"`
- `localWhisperModelsDir: "~/Library/Application Support/Vaani/models/"`

**Model download UX:**
- Show available whisper.cpp models with sizes and estimated latency
- Download with progress bar
- Cache models in Application Support
- tiny.en is bundled (78MB), others downloaded on demand

**Files touched:**
- New: `src/native/whisper/whisper_engine.mm`, `src/native/whisper/model_manager.mm`, `src/main/providers/local/whisperCpp.ts`
- Modified: `binding.gyp`, `forge.config.ts` (extra resources for models), `src/main/providers/registry.ts`, Settings UI

### 2.2 — Local LLM for formatting (optional, stretch)

**What:** On-device LLM via llama.cpp for punctuation/formatting when offline.

**Approach:**
- Use `node-llama-cpp` npm package
- Ship a tiny LLM (Llama 3.2 1B, ~500MB GGUF)
- Only active when offline or when user selects "local" formatting provider
- Much slower than cloud LLMs but works fully offline

**Priority:** Medium. Cloud formatting is acceptable for most users. Can be Phase 5.

### 2.3 — Offline mode indicator

**What:** Clear UI indication of whether Vaani is working offline or online.

**Implementation:**
- Tray icon dot: green (online), amber (local model), red (no connection, no local model)
- Settings page: "Connection Status" card showing active provider and mode
- Keyboard shortcut: Auto-switch to local model when internet is down (with notification)

---

## Phase 3: Power User Features (2-3 weeks)

### 3.1 — System audio capture (ScreenCaptureKit)

**What:** Capture system audio output alongside microphone — useful for recording meetings, calls, videos.

**Why:** TypeWhisper does this via ScreenCaptureKit. Vaani cannot currently capture system audio.

**Implementation:**
- Create `src/native/audio/system_audio.mm` using ScreenCaptureKit
- APIs to expose:
  ```c
  bool StartSystemAudioCapture();
  bool StopSystemAudioCapture();
  void SetSystemAudioCallback(Napi::ThreadSafeFunction callback);
  ```
- The callback delivers PCM audio buffers at 48kHz stereo
- In the TypeScript layer, mix system audio + microphone into a single stream
- Add "Capture System Audio" toggle setting
- Requires `com.apple.security.device.audio-input` entitlement (already present)
- Note: ScreenCaptureKit requires user permission on first use — prompt flow needed

**Files touched:**
- New: `src/native/audio/system_audio.mm`
- Modified: `binding.gyp`, `src/main/audio/macAudioSession.ts`, `src/main/dictation.ts`, Settings UI

### 3.2 — Streaming transcription

**What:** Show partial transcription results in real-time as the user speaks.

**Why:** TypeWhisper's WhisperKit does streaming. Groq Whisper doesn't support streaming, but we can implement chunked transcription.

**Approach:**
- Split audio into overlapping chunks (e.g., 3-second windows with 1.5s overlap)
- Send each chunk for transcription as it's recorded
- Merge partial results and display in the overlay
- Use a simple diff/patch algorithm to update the displayed text
- Requires switching to a provider that supports streaming or fast enough chunked requests

**Implementation:**
- Add `streaming: boolean` to `TranscriptionOptions`
- In `DictationService`, when streaming is enabled:
  - Buffer audio in 500ms chunks
  - Every 1.5s, send the accumulated audio for transcription
  - Display partial text in the overlay with a "typing..." indicator
- The overlay shows the partial result during recording (new capsule state: "streaming")

**Overlay states to add:**
- `streaming` — shows partial text with blinking cursor, recording bars still visible

**Files touched:** `src/main/dictation.ts`, `src/renderer/overlay/CapsuleOverlay.tsx`, `src/main/overlay.ts`

### 3.3 — Per-app profiles

**What:** Different dictation settings (language, provider, formatting style) based on the active application.

**Why:** TypeWhisper has this. Users want Hindi in WhatsApp, English with code formatting in VSCode.

**Implementation:**

```typescript
// src/shared/types.ts
export interface AppProfile {
  id: string;
  name: string;
  appBundleIds: string[];        // ["com.apple.Terminal", "com.googlecode.iterm2"]
  transcriptionProvider?: string; // override global provider
  formattingProvider?: string;
  language?: string;
  formattingStyle?: "default" | "strict" | "casual" | "code";
  autoSubmit?: boolean;
  customPrompt?: string;
}

export interface Settings {
  // ... existing
  appProfiles: AppProfile[];
  enableProfiles: boolean;
}
```

- In `DictationService.beginHotkeySession()`, check the frontmost app against profiles
- `AppDetector.getContext()` already returns the bundle ID — use it to match profiles
- Add a Profiles settings page showing configured app profiles
- "Add profile for current app" quick action in tray menu

**Files touched:** `src/shared/types.ts`, `src/main/dictation.ts`, `src/main/context/appDetector.ts`, Settings UI (new Profile page)

### 3.4 — Workflow / Prompt Actions

**What:** Post-dictation actions executed automatically, like summarizing, translating, or formatting as a specific structure.

**Why:** TypeWhisper has `PromptActionService` and `WorkflowService`. Vaani has no concept of this.

**Implementation:**

```typescript
export interface PromptAction {
  id: string;
  name: string;                    // "Summarize", "Translate to French", "Format as JSON"
  prompt: string;                  // System prompt sent to LLM
  postProcess?: string;            // "replace" | "prepend" | "append" | "clipboard"
  trigger?: "manual" | "auto";     // auto = always run, manual = via shortcut
}
```

- After transcription, if an auto-trigger action is configured, send the text through the LLM with the action's system prompt
- "Prompt palette" — overlay that shows available actions after transcription completes
- Keyboard shortcut to open prompt palette
- Example built-in actions: "Summarize", "Fix grammar", "Translate to [language]", "Format as bullet list", "Extract action items"

**Files touched:**
- New: `src/main/workflows.ts`, `src/main/promptActions.ts`
- Modified: `src/main/dictation.ts`, `src/shared/types.ts`, `src/renderer/overlay/CapsuleOverlay.tsx`

### 3.5 — Snippets with placeholders

**What:** Snippet triggers like `{{TIME}}`, `{{DATE}}`, `{{CLIPBOARD}}` in addition to existing slash commands.

**Why:** TypeWhisper has this. Makes snippets more powerful.

**Implementation:**
- In `cleanupText()`, after slash-command expansion, process `{{PLACEHOLDER}}` tokens
- Supported placeholders: `{{DATE}}`, `{{TIME}}`, `{{DATETIME}}`, `{{CLIPBOARD}}`, `{{APP_NAME}}`, `{{URL}}`
- Implement in `src/main/text/cleanup.ts` as a new step in the pipeline

**Files touched:** `src/main/text/cleanup.ts`, `src/shared/types.ts`, Settings UI

### 3.6 — Speech-to-text language selection per recording

**What:** Quick language switching from the tray menu or overlay without opening settings.

**Why:** Common user request. Switching languages currently requires opening settings.

**Implementation:**
- Add a "Language" submenu in the tray with recently used languages
- Or add a language indicator to the overlay capsule that can be clicked/tapped
- Store recently used languages in settings

**Files touched:** `src/main/tray.ts`, `src/renderer/overlay/CapsuleOverlay.tsx`

---

## Phase 4: Developer Platform (3-4 weeks)

### 4.1 — Plugin system

**What:** Allow third-party developers to add providers, actions, and post-processors.

**Why:** TypeWhisper's plugin ecosystem (35 plugins, community registry) is its biggest differentiator. Vaani can match this with an Electron-native plugin system.

**Architecture:**

```
src/main/plugins/
├── types.ts              # PluginManifest, PluginProtocol definitions
├── loader.ts             # PluginLoader — discovers, validates, loads plugins
├── sandbox.ts            # PluginSandbox — isolates plugins in separate contexts
└── registry.ts           # PluginRegistry — manages installed plugins
```

**Plugin manifest (`plugin.json`):**
```json
{
  "id": "com.example.vaani-openai",
  "name": "OpenAI Provider",
  "version": "1.0.0",
  "sdkVersion": "1",
  "type": "stt",
  "main": "dist/index.js",
  "permissions": ["network", "keychain"],
  "settings": [
    { "key": "apiKey", "label": "API Key", "type": "secret" },
    { "key": "model", "label": "Model", "type": "select", "options": ["whisper-1"] }
  ]
}
```

**Plugin types:**
- `stt` — Speech-to-text provider
- `llm` — LLM formatting provider  
- `post-processing` — Text transformation
- `action` — Post-transcription action (e.g., create GitHub issue)
- `memory` — Context storage backend

**Plugin locations:**
- `~/.vaani/plugins/` — User-installed plugins
- `app.getAppPath()/plugins/` — Bundled plugins
- Node modules: Any `vaani-plugin-*` package in `node_modules`

**Plugin loading:**
- Plugins are CommonJS or ESM modules loaded via Node.js `require()` / dynamic `import()`
- Each plugin runs in its own context (not full VM isolation — trust model)
- Plugin exposes a factory function: `module.exports = { createPlugin(config) { return { ... } } }`
- Plugins are validated against the SDK version before loading
- Plugins can declare npm dependencies (bundled) or use what's available

**Plugin SDK package:**
- Create `@vaani/plugin-sdk` npm package with the interfaces
- Publish to npm
- Include TypeScript types for easy plugin development

**Files touched:**
- New: `src/main/plugins/types.ts`, `src/main/plugins/loader.ts`, `src/main/plugins/sandbox.ts`, `src/main/plugins/registry.ts`
- New: `@vaani/plugin-sdk` (separate npm package)
- Modified: `src/main/providers/registry.ts` (accepts plugin providers), Settings UI (plugin manager page)

### 4.2 — HTTP API + CLI

**What:** Programmatic access to dictation — start/stop recording, transcribe files, query history.

**Why:** TypeWhisper has a full CLI + REST API. This enables scripting, automation, and IDE integration.

**HTTP API:**

```
POST   /api/v1/dictation/start      # Start recording
POST   /api/v1/dictation/stop       # Stop and transcribe
GET    /api/v1/dictation/status     # Current state
POST   /api/v1/transcribe           # Transcribe an audio file
POST   /api/v1/format               # Format text via LLM
GET    /api/v1/history              # List history entries
DELETE /api/v1/history/:id          # Delete entry
GET    /api/v1/settings             # Get settings
PATCH  /api/v1/settings             # Update settings
GET    /api/v1/providers            # List providers
GET    /api/v1/health               # Health check
```

**Implementation:**
- Use Node.js built-in `http` module (no extra dependency, matches Vaani's minimalism)
- Listen only on `127.0.0.1:8978` (configurable)
- API token authentication (token stored in Keychain via Phase 0.3)
- Port discovery file: `~/.vaani/api-port.json` (like TypeWhisper's `api-discovery.json`)

**CLI tool:**
```
vaani status                    # Show connection status
vaani transcribe <file>         # Transcribe audio file
vaani dictation start           # Start dictation
vaani dictation stop            # Stop dictation
vaani history [--last N]        # Show recent transcriptions
vaani configure                 # Interactive setup wizard
```

**Implementation:**
- New directory: `cli/` with a standalone Node.js script
- Uses the HTTP API to communicate with the running Vaani app
- Can be installed via `npm install -g @vaani/cli` or bundled with the app
- Discovers port from `~/.vaani/api-port.json`

**Files touched:**
- New: `src/main/api/` directory (HTTPServer, routes, middleware)
- New: `cli/` directory (CLI tool)
- Modified: `src/main/index.ts` (start API server in bootstrap)

### 4.3 — Keyboard Maestro / Alfred / Raycast integration

**What:** Make Vaani controllable from popular macOS automation tools.

**How:**
- HTTP API + CLI already enable this
- Create pre-built workflows for Keyboard Maestro and Raycast
- Document URL scheme `vaani://dictation/start` for deep linking
- Add to docs

**Files touched:** Documentation, pre-built integration files in `integrations/`

---

## Phase 5: Polish & Distribution (2-3 weeks)

### 5.1 — Memory / Context system

**What:** Remember user preferences, style, vocabulary, and conversation context across sessions.

**Implementation:**
- Create `src/main/context/memory.ts`
- Store:
  - Frequently used custom corrections
  - Per-app vocabulary (coding terms in VSCode, messaging slang in WhatsApp)
  - Recent topics/context for better formatting
- Simple approach: weighted term frequency across history
- Advanced approach: vector embeddings via a small local model
- Use the formatting LLM to maintain a running context summary

**Files touched:**
- New: `src/main/context/memory.ts`
- Modified: `src/main/transcription.ts` (inject context into prompt), `src/main/formatting.ts`

### 5.2 — Dictation recovery

**What:** If the app crashes during dictation, recover the audio and offer to transcribe it.

**Why:** TypeWhisper has `DictationRecoveryAudioStore` and shows a recovery view.

**Implementation:**
- Save the audio buffer to a temp file as soon as recording stops
- On next app launch, check for unrecovered audio files
- Show a "Recover unsaved dictation?" prompt
- If accepted, transcribe and inject

**Files touched:** `src/main/dictation.ts`, `src/main/index.ts`, `src/renderer/` (recovery UI)

### 5.3 — Translation

**What:** Translate dictated text to another language.

**Implementation:**
- Use the formatting LLM with a translation prompt: "Translate the following text to French. Output only the translation."
- Add a "Translate" action to the prompt palette (Phase 3.4)
- Add a setting for default translation target language
- Could also leverage macOS built-in translation (available via AppleScript/Shortcuts)

**Files touched:** `src/main/promptActions.ts`, Settings UI

### 5.4 — Export formats

**What:** Export history entries as SRT, TXT, CSV, or JSON.

**Implementation:**
- Add export options to History page
- SRT export with timestamps (use audio duration and word count to estimate timestamps)
- TXT export: plain text, one entry per line
- CSV export: all metadata columns
- JSON export: full structured data

**Files touched:** New `src/main/export.ts`, History page UI

### 5.5 — Notarization & code signing

**What:** Fully notarized macOS app — currently `notarize` is commented out in `forge.config.ts`.

**Implementation:**
- Set up Apple Developer account for code signing
- Configure `@electron-forge/maker-dmg` with notarization
- Use `@electron/notarize` or `electron-notarize`
- Add to CI workflow

**Files touched:** `forge.config.ts`, `.github/workflows/release.yml`, `entitlements.plist`

### 5.6 — Auto-update channels

**What:** Offer stable and beta release channels.

**Implementation:**
- `electron-updater` already configured with GitHub provider
- Add a "Release Channel" setting: `stable` | `beta`
- For beta: check a different GitHub release (use prerelease flag)
- Add channel info to the About page
- Nightly builds via CI on push to main

**Files touched:** `src/main/index.ts`, Settings UI, `.github/workflows/release.yml`

### 5.7 — Performance optimization

**What:** Reduce memory usage and startup time.

**Specific actions:**
- Lazy-load providers (don't init SDKs until needed)
- Use `BrowserWindow` pooling (don't recreate windows)
- Optimize native module loading (cache, defer)
- Profile and reduce Vite bundle size
- Consider moving recorder from hidden BrowserWindow to main process (would reduce one Chromium instance)

**Priority:** Ongoing. Most impactful: move recorder to main process (cuts RAM by ~100MB).

---

## Architecture Decisions

### Why not rewrite in Swift?

TypeWhisper proves Swift gives a superior native experience. But Vaani's Electron stack has advantages:
- **Faster iteration** — React + TypeScript development is 3-5x faster than SwiftUI
- **Cross-platform potential** — Windows/Linux versions with ~20% extra effort
- **Plugin ecosystem** — npm packages outnumber Swift packages 1000:1
- **Web-native UI flexibility** — Tailwind, Framer Motion, shadcn/ui give Vaani's UI more visual polish than any SwiftUI app, TypeWhisper included

The strategy: **Lean into Electron's strengths (web UI, npm ecosystem, fast dev) while matching Swift's strengths via native addons (CoreAudio, ScreenCaptureKit, whisper.cpp, CGEventTap).**

### Why a plugin system instead of an open-core model?

TypeWhisper's GPLv3 + commercial model and plugin ecosystem proves there's demand. Vaani should go further: **MIT + full plugin ecosystem** means:
- Community can add any provider without waiting on maintainers
- Enterprise users can create private plugins for internal systems
- Plugin marketplace becomes a moat (TypeWhisper's 35 plugins are its biggest asset)

### Native module strategy

Vaani already has 3 `.mm` files. Plan to add 2-3 more:
1. `whisper_engine.mm` — whisper.cpp integration
2. `system_audio.mm` — ScreenCaptureKit
3. `keychain.mm` — (optional, keytar is sufficient)

Keep native modules focused on capabilities that are impossible in pure Node.js:
- CGEventTap (already done)
- AX APIs (already done)
- CoreAudio device management (already done)
- ScreenCaptureKit (new)
- whisper.cpp (new)

Everything else stays in TypeScript.

---

## File Change Map

### New files to create:

```
src/main/providers/
├── types.ts
├── registry.ts
├── groq/groqStt.ts
├── groq/groqLlm.ts
├── openai/openaiStt.ts
├── openai/openaiLlm.ts
├── anthropic/anthropicLlm.ts
├── deepgram/deepgramStt.ts
├── local/whisperCpp.ts
└── openai-compatible/openAiCompatible.ts

src/main/plugins/
├── types.ts
├── loader.ts
├── sandbox.ts
└── registry.ts

src/main/api/
├── server.ts
├── routes.ts
├── middleware.ts
└── handlers.ts

src/main/store/
└── credentials.ts         # Keychain integration

src/main/context/
├── appDetector.ts          # (exists, extend)
└── memory.ts               # NEW

src/main/workflows.ts
src/main/promptActions.ts
src/main/export.ts

src/native/whisper/
├── whisper_engine.mm
├── whisper_engine.h
├── model_manager.mm
└── model_manager.h

src/native/audio/
└── system_audio.mm

src/renderer/pages/
└── Providers.tsx           # NEW
└── Profiles.tsx            # NEW
└── Plugins.tsx             # NEW

cli/
├── package.json
├── index.ts
└── commands/

@vaani/plugin-sdk/
├── package.json
├── src/
│   ├── index.ts
│   └── types.ts
└── tsconfig.json
```

### Files to modify:

```
src/shared/types.ts          # Add provider, profile, plugin, workflow types
src/shared/defaults.ts       # Add new defaults
src/shared/ipc.ts            # Add new IPC channels
src/main/index.ts            # Bootstrap API server, plugin loader
src/main/dictation.ts        # Use ProviderRegistry, add profiles, add streaming
src/main/transcription.ts    # Deprecate, redirect to providers
src/main/formatting.ts       # Deprecate, redirect to providers
src/main/hotkeys.ts          # Add push-to-talk mode
src/main/tray.ts             # Add language submenu, quick actions
src/main/overlay.ts          # Add streaming/prompt states
src/main/text/cleanup.ts     # Add snippet placeholders
src/main/audio/macAudioSession.ts  # Add system audio mix
src/main/injection/policy.ts       # Add more app targets
src/main/nativeBridge.ts     # Add new native function types
src/renderer/App.tsx         # Add new routes
src/renderer/pages/Settings* # Add provider, profile, plugin panes
src/renderer/overlay/CapsuleOverlay.tsx  # New states
src/renderer/context/vaani-ui.tsx        # New context fields
binding.gyp                  # Add whisper_engine, system_audio targets
forge.config.ts              # Add extraResources for models
package.json                 # New dependencies
```

### Packages to add:

```json
{
  "dependencies": {
    "openai": "^4.x",           // OpenAI STT + LLM (Phase 1)
    "@anthropic-ai/sdk": "^0.x", // Claude formatting (Phase 1)
    "@deepgram/sdk": "^3.x",     // Deepgram STT (Phase 1)
    "keytar": "^7.x"             // Keychain (Phase 0)
  },
  "devDependencies": {
    "@types/keytar": "^7.x"
  }
}
```

---

## Release Roadmap

| Version | Phase | Feature Highlights |
|---------|-------|-------------------|
| **1.1** | Phase 0 | Recording to disk, push-to-talk, Keychain, Fn key improvements |
| **1.2** | Phase 1a | Provider abstraction, OpenAI STT + LLM, Settings UI |
| **1.3** | Phase 1b | Deepgram, Anthropic, auto-failover |
| **1.4** | Phase 2 | whisper.cpp offline STT, offline mode indicator |
| **2.0** | Phase 3 | Per-app profiles, workflows, prompt actions, streaming transcription |
| **2.2** | Phase 4 | Plugin system, HTTP API, CLI tool |
| **2.3** | Phase 5a | Memory, dictation recovery, translation, export |
| **3.0** | Phase 5b | System audio capture, notarization, release channels |

---

## Competitive Positioning After Full Implementation

| Feature | TypeWhisper (Current) | Vaani (After Plan) |
|---------|----------------------|-------------------|
| STT engines | 17 (6 local) | 5+ cloud + 1 local |
| LLM providers | 11 + Apple Intelligence | 4+ cloud + optional local |
| Plugin ecosystem | ✅ 35 plugins, full SDK | ✅ Plugin SDK with npm distribution |
| Offline capable | ✅ Yes | ✅ whisper.cpp |
| System audio capture | ✅ ScreenCaptureKit | ✅ ScreenCaptureKit |
| Push-to-talk | ✅ Yes | ✅ Yes |
| Streaming transcription | ✅ WhisperKit | ✅ Chunked transcription |
| Per-app profiles | ✅ Yes | ✅ Yes |
| Workflows | ✅ Full workflow system | ✅ Prompt actions + workflows |
| CLI + API | ✅ Yes | ✅ Yes |
| Memory/context | ✅ Plugin-based | ✅ File + optional vector |
| Recording to disk | ✅ WAV + M4A | ✅ WAV |
| Export formats | ✅ SRT + more | ✅ SRT, TXT, CSV, JSON |
| Widgets | ✅ 4 WidgetKit | ❌ (Electron limitation) |
| Multilingual UI | ✅ en + de | ❌ (can add en + hi + de) |
| Cross-platform | ❌ (macOS only) | ✅ Potential Windows/Linux |
| License | GPLv3 + Commercial | MIT (fully open) |
| UI polish | Native SwiftUI | ✅ Custom themes, Framer Motion |

**The gap closes considerably.** Vaani would match or exceed TypeWhisper in:
- Provider ecosystem (npm > SPM packages)
- UI flexibility (web-native)
- Cross-platform potential
- MIT licensing (no commercial restrictions)

TypeWhisper retains advantages in:
- On-device Apple Intelligence (only possible in Swift)
- WidgetKit widgets (native-only)
- Deeper native audio integration (AVAudioEngine vs MediaRecorder)
- Larger existing plugin library

---

*Plan scope: ~12-14 weeks of focused development for full implementation. Start with Phase 0 (immediate value, low risk) and Phase 1 (biggest competitive gap closer).*
