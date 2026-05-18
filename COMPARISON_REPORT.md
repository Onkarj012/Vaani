# TypeWhisper vs Vaani — Detailed Comparative Analysis

**Generated:** May 18, 2026 (updated for Vaani v1.0.4)
**Projects:** `typewhisper-mac/` (Swift) vs `Vaani_main/` (Electron)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Languages & Stack](#2-languages--stack)
3. [Build System & Packaging](#3-build-system--packaging)
4. [macOS Hotkey / Global Shortcut Implementation](#4-macos-hotkey--global-shortcut-implementation)
5. [Microphone / Audio Capture](#5-microphone--audio-capture)
6. [LLM / AI Integration](#6-llm--ai-integration)
7. [Text Injection / Accessibility](#7-text-injection--accessibility)
8. [Plugin / Extensibility Architecture](#8-plugin--extensibility-architecture)
9. [UI Framework & Windows](#9-ui-framework--windows)
10. [Speech-to-Text Engines](#10-speech-to-text-engines)
11. [Text Processing & Formatting](#11-text-processing--formatting)
12. [Memory & Context](#12-memory--context)
13. [Auto-Update & Licensing](#13-auto-update--licensing)
14. [CLI & API Surface](#14-cli--api-surface)
15. [Testing](#15-testing)
16. [Permissions & Entitlements](#16-permissions--entitlements)
17. [Privacy & Telemetry](#17-privacy--telemetry)
18. [CI/CD & Distribution](#18-cicd--distribution)
19. [Summary Table](#19-summary-table)
20. [Architectural Philosophy](#20-architectural-philosophy)

---

## 1. Project Overview

| Aspect | TypeWhisper (Swift) | Vaani (Electron) |
|--------|-------------------|-------------------|
| **Purpose** | Full-featured macOS dictation + transcription app with plugin ecosystem | Minimal, fast macOS voice dictation powered by Groq |
| **Language** | Swift 6 (98%), Obj-C bridging (minimal) | TypeScript (60%), C++/Obj-C++ native addon (20%) |
| **Min macOS** | 14.0 (Sonoma), 15+ for translation, 26+ for Apple Intelligence | macOS 12+ (Monterey) |
| **License** | GPLv3 + Commercial | MIT |
| **Codebase size** | ~160+ Swift files (app) + 35 plugin targets + CLI + Widgets | ~50 TypeScript files + 3 native `.mm` files |
| **Release channels** | Stable, Release Candidate, Daily | Single channel via GitHub Releases |
| **Version** | ~0.9.2 | 1.0.4 |

---

## 2. Languages & Stack

| Technology | TypeWhisper | Vaani |
|------------|-------------|-------|
| **Primary language** | Swift 6 (strict concurrency) | TypeScript 5.8 (strict mode) |
| **Native code** | Swift native, Obj-C bridging only for exception catching | C++/Obj-C++ `.mm` files via node-gyp/node-addon-api |
| **UI framework** | SwiftUI (MenuBarExtra, WindowGroup, panels) | React 19.1 with Framer Motion |
| **CSS framework** | N/A (AppKit/SwiftUI native) | Tailwind CSS v4 + shadcn/ui |
| **Package manager** | Swift Package Manager + Xcode | Bun (bun.lock) |
| **Build tool** | Xcode 16+ (xcodebuild) | Electron Forge + Vite 6 |
| **Charts** | N/A | Recharts 3.8 |
| **Animation** | SwiftUI built-in | Framer Motion 12 |
| **State management** | MVVM with ServiceContainer DI | React Context (VaaniUiProvider + ThemeContext) |

**Key Insight:** TypeWhisper is a pure-native macOS citizen — every line of UI, audio handling, and system integration speaks the platform's native language. Vaani is a cross-platform web stack (Electron) with a thin native layer glued via node-addon-api.

---

## 3. Build System & Packaging

| Aspect | TypeWhisper | Vaani |
|--------|-------------|-------|
| **Build tool** | `xcodebuild` (Xcode 16+) | `electron-forge` + `vite` |
| **Config files** | `TypeWhisper.xcodeproj`, `CodeSigning.xcconfig` | `forge.config.ts`, 7 Vite configs |
| **Native build** | Built-in (Swift/Obj-C compiled by Xcode) | `node-gyp` via `binding.gyp` → `vaani_native.node` |
| **Output** | `.app` bundle (universal binary) | `.app` bundle + DMG/ZIP |
| **Code signing** | CodeSigning.xcconfig with `APP_GROUP_ID`, hardened runtime | entitlements.plist, hardened runtime (notarization commented out) |
| **ASAR** | N/A | Yes (with auto-unpack natives) |
| **Architecture** | Universal (Apple Silicon + Intel) | Node.js + Electron (arm64/x64) |
| **Build complexity** | Single `xcodebuild` command | `bun run build` → node-gyp → forge package (3 stages) |

**Key Insight:** TypeWhisper uses Xcode's mature build system — native compilation is first-class. Vaani has a multi-stage build where native `.mm` files must be compiled by node-gyp, then the Electron app is packaged by Forge, creating more potential failure points.

---

## 4. macOS Hotkey / Global Shortcut Implementation

### TypeWhisper (`HotkeyService.swift`)

- **Primary mechanism:** `CGEventTap` (`.cgSessionEventTap`, `.tailAppendEventTap`)
- **Fallback:** `NSEvent` global + local monitors
- **Threading:** Swift concurrency (`@MainActor`, `OSAllocatedUnfairLock`)
- **Hotkey types supported:**
  - Key + modifier combos (Cmd+Shift+A)
  - Modifier-only combos (Cmd+Opt alone)
  - Fn key (press/release and release-only)
  - Bare keys
  - Mouse buttons (2-4, including double-tap)
  - Double-tap variants of any of the above
- **Hotkey slots:** hybrid, push-to-talk, toggle, prompt palette, recent transcriptions, copy last, recorder toggle
- **Per-profile and per-workflow hotkeys**
- **Caps Lock origin suppression**
- **Push-to-talk interruption detection**
- **Source lines:** ~1527 lines of Swift

### Vaani (`hotkey_monitor.mm`)

- **Primary mechanism:** `CGEventTap` via dedicated pthread with its own CFRunLoop
- **Fallback:** Electron `globalShortcut` API
- **Threading:** `Napi::ThreadSafeFunction` to bridge native → JS
- **Hotkey types supported:**
  - Key + modifier combos (Cmd, Option, Ctrl, Shift, Fn)
  - Fn key (special handling — CGEvent doesn't expose Fn as modifier)
  - Double-press detection (350ms window) for toggle mode
  - Min hold time 300ms before key-up emission
- **Hotkey slots:** Dictation toggle, Paste Latest
- **Key code mapping:** Full QWERTY A-Z, 0-9, F1-F20, Space, Return, Tab, Escape, arrows
- **Modifier handling:** Left + right variants for all modifiers
- **Source lines:** ~1 `.mm` file

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| CGEventTap | ✅ Primary | ✅ Primary |
| NSEvent fallback | ✅ Yes | ❌ No (electron globalShortcut instead) |
| Fn key support | ✅ Yes (press/release, release-only) | ✅ Yes |
| Mouse button hotkeys | ✅ Buttons 2-4 | ❌ No |
| Double-tap variants | ✅ Yes | ✅ Yes (toggle mode) |
| Per-profile hotkeys | ✅ Yes | ❌ No |
| Push-to-talk | ✅ Yes (with interruption detection) | ❌ Toggle only (min-hold 300ms) |
| Caps Lock suppression | ✅ Yes | ❌ No |
| Thread safety | Swift concurrency + OSAllocatedUnfairLock | Napi::ThreadSafeFunction |
| Lines of code | ~1527 Swift | ~1 Obj-C++ file |

**Key Insight:** TypeWhisper has a vastly more sophisticated hotkey system — mouse buttons, per-profile hotkeys, push-to-talk with interruption, caps lock suppression, and multiple hotkey slots. Vaani covers the essential dictation-toggle + paste-latest combo with double-press support, but lacks the breadth of TypeWhisper's hotkey feature set.

---

## 5. Microphone / Audio Capture

### TypeWhisper

- **Primary capture:** `AVAudioEngine` with `installTap(onBus:...)` on input node
- **Sample rate:** 16 kHz mono Float32 (for transcription)
- **Buffer size:** 256 frames
- **Format conversion:** `AVAudioConverter` for sample rate conversion
- **System audio capture:** `ScreenCaptureKit` (`SCStream`, `SCShareableContent`) at 48 kHz, 2ch, 16-bit PCM
- **Output recording:** WAV (PCM) and M4A (AAC), mixed or separate tracks
- **Audio ducking:** CoreAudio-based output volume control
- **Device management:** `AudioDeviceService` (~2651 lines) — enumerate/select/manage via CoreAudio
- **Bluetooth stabilization:** Input route stabilization for AirPods/Jabra
- **Audio engine recovery:** Retry backoff, config change handling, circuit breaker
- **Audio processing:** Ducking, gain control, Bluetooth transport detection
- **Temp file management:** System temp + `~/Documents/TypeWhisper Recordings/`
- **Source lines:** ~1220 (recording) + ~1310 (recorder) + ~2651 (device mgmt)

### Vaani

- **Primary capture:** `MediaRecorder` Web API in hidden BrowserWindow
  - `navigator.mediaDevices.getUserMedia()` with mono, 1 channel
  - Codec: `audio/webm;codecs=opus` (falls back to webm, ogg)
  - Chunks every 250ms
- **Post-processing:** `blobToClip()` pipeline:
  - AudioContext.decodeAudioData → mix to mono → resample to 16kHz → calculate RMS frames
- **VAD:** `trimSilence()` — RMS threshold-based silence trimming
  - 12 frames leading padding, 35 frames trailing padding
  - Min clip duration 0.5s default
- **WAV creation:** `createWavBuffer()` — PCM → WAV
- **Device management:** Native `injector.mm` — CoreAudio device switching:
  - `PrepareRecordingInput()` saves current device, switches to built-in mic
  - `RestoreRecordingInput()` restores original
  - Virtual device filtering (BlackHole, Loopback, Soundflower)
- **Audio ducking prevention:** `macAudioSession.ts` configures AVAudioSessionCategoryOptions
- **Audio visualization:** Web Audio API AnalyserNode, FFT 2048, 9-bar waveform
- **Source lines:** ~1 renderer file + 1 native .mm + 1 macAudioSession.ts

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Capture API | AVAudioEngine (native) | MediaRecorder (Web API) |
| Sample rate | 16 kHz mono Float32 | 16 kHz (via AudioContext resampling) |
| System audio capture | ✅ ScreenCaptureKit | ❌ No |
| Output recording | ✅ WAV + M4A files | ❌ No (transient only) |
| Audio ducking | ✅ CoreAudio-based control | ❌ Prevention only |
| VAD / silence trim | ❌ (relies on engine-level) | ✅ RMS threshold trimming |
| Device enumeration | ✅ Full CoreAudio (~2651 lines) | ✅ CoreAudio via native bridge (~few lines) |
| Bluetooth support | ✅ Input route stabilization | ❌ Avoids Bluetooth |
| Engine recovery | ✅ Retry backoff + circuit breaker | ❌ Reload recorder window |
| Virtual device filtering | ❌ Not needed (explicit device IDs) | ✅ Yes |
| Audio visualization | ✅ Waveform view (SwiftUI) | ✅ 9-bar FFT waveform |
| Recording to disk | ✅ WAV/M4A with mixed/separate tracks | ❌ No persistent recording |

**Key Insight:** TypeWhisper's audio pipeline is vastly more sophisticated — native AVAudioEngine with format conversion, ScreenCaptureKit for system audio, full CoreAudio device management, ducking control, and robust engine recovery. Vaani uses the simpler MediaRecorder Web API with JS-based post-processing, which is more portable but less capable and potentially higher latency.

---

## 6. LLM / AI Integration

### TypeWhisper

- **Apple Intelligence (macOS 26+):** `FoundationModelsProvider.swift` — native `LanguageModelSession`
- **Plugin-based LLM providers** (via PluginManager):
  - OpenAI / ChatGPT
  - OpenAI Compatible (any API)
  - Groq
  - xAI/Grok
  - Google Gemini
  - Anthropic Claude
  - Cohere
  - Fireworks
  - Cerebras
  - OpenRouter
  - Local Gemma 4 (MLX) — on-device Apple Silicon
- **Usage:** Prompt processing, text formatting, post-transcription actions
- **Plugin protocol:** `LLMProviderPlugin` with `processPrompt()`, `formatTranscript()`

### Vaani

- **Multi-provider engine (v1.0.4):**
  - **Transcription providers:** Groq Whisper, OpenAI Whisper, Deepgram Nova-2, Local whisper.cpp (offline), OpenAI-compatible (any endpoint)
  - **Formatting providers:** Groq Llama, OpenAI GPT, Anthropic Claude, OpenRouter (multi-model)
- **Transcription:** Up to 3 retries, 2s delay, custom vocabulary hints via `prompt` parameter, multi-language + "hinglish" mode
- **Formatting:**
  - Adds punctuation + capitalization
  - Two-pass formatting with strict fallback
  - Multiple sanity checks:
    - First sentence overlap ratio (>50%)
    - Lead word overlap (>50%)
    - Ordered token preservation (>82%)
    - Vocabulary overlap (>55%)
    - Length change guards (can't shorten >55%, expand >150%+50 chars)
    - Word count difference (max 3+cue-words)
    - Assistant reply pattern detection
- **Offline capable:** whisper.cpp runs entirely on-device — no internet, no API keys

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Apple Intelligence | ✅ `FoundationModels` framework | ❌ No |
| OpenAI | ✅ Plugin | ✅ Provider |
| Groq | ✅ Plugin | ✅ Provider |
| xAI/Grok | ✅ Plugin | ❌ No |
| Google Gemini | ✅ Plugin | ❌ No |
| Anthropic Claude | ✅ Plugin | ✅ Provider |
| OpenRouter | ✅ Plugin | ✅ Provider |
| Local on-device LLM | ✅ Gemma 4 via MLX | ❌ No |
| Local transcription | ✅ WhisperKit, Parakeet, Granite, Qwen3, Voxtral | ✅ whisper.cpp |
| Cloud transcription | ✅ 7+ providers | ✅ 4+ (Groq, OpenAI, Deepgram, OpenAI-compatible) |
| Formatting sanity checks | ❌ (handled per-plugin) | ✅ Extensive (7 checks) |
| Two-pass formatting | ❌ | ✅ Yes |
| Provider count | 11 LLM + 5+ transcription providers | 5 STT + 4 LLM providers |

**Key Insight:** TypeWhisper supports a vast ecosystem of 11+ LLM providers and 7+ cloud/local transcription engines, including on-device MLX models and Apple Intelligence. Vaani is exclusively tied to Groq — both for transcription (Whisper) and formatting (Llama). Vaani compensates with unusually thorough output sanity checks and two-pass formatting.

---

## 7. Text Injection / Accessibility

### TypeWhisper (`TextInsertionService.swift`)

- **Primary:** AXUIElement-based text insertion
- **Clipboard + Cmd+V** simulated paste
- **Browser URL detection:** Safari, Chrome, Arc, Firefox, Chromium
- **Focused text field state capture**
- **AccessibilityAnnouncementService:** VoiceOver announcements
- **Source lines:** ~701 Swift

### Vaani (`accessibility.ts`, `clipboard.ts`, `target.ts`, `policy.ts`, native `injector.mm`)

- **Policy-driven injection** with per-app awareness:
  - Clipboard-only apps: terminals, browsers, Electron apps, Slack, Discord, Notion, Cursor, Windsurf, Zed, Figma, messaging
  - Typing-preferred apps: WhatsApp, Antigravity, Telegram, Signal
  - System Events paste: WhatsApp, Messages, Telegram, Signal
- **Injection methods** (in priority order):
  1. AX API text injection (native `injectText`)
  2. Clipboard paste via CGEvent (native `pasteText`)
  3. Clipboard paste via AppleScript (System Events)
  4. Keystroke typing via native bridge
  5. Keystroke typing via AppleScript
- **Safety:** Clipboard restoration, modifier key release, confirmation via selection tracking
- **App context detection** → casual/formal/developer/default
- **Source lines:** 5 TypeScript files + 1 native `.mm` file

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| AX API injection | ✅ Yes | ✅ Yes (native) |
| CGEvent clipboard paste | ✅ Yes | ✅ Yes (native) |
| AppleScript paste | ❌ No | ✅ Yes |
| Character-by-character typing | ❌ No | ✅ Yes (native `typeText`) |
| Per-app injection policy | ❌ No | ✅ Yes (30+ apps, 4 categories) |
| Clipboard restore | ❌ No | ✅ Yes (with verification) |
| Modifier key release | ❌ No | ✅ Yes |
| Browser URL detection | ✅ 4 browsers | ❌ No (app context only) |
| App context detection | ❌ No | ✅ 4 context categories |
| Auto-submit after paste | ✅ Yes | ❌ No |
| Selection tracking | ❌ No | ✅ Via `getFocusedSelection()` |
| VoiceOver | ✅ AccessibilityAnnouncementService | ❌ No |

**Key Insight:** Vaani has a far more sophisticated text injection system with 5 fallback methods, per-app policies, clipboard safety, and extensive targeting logic. TypeWhisper uses a simpler AX + clipboard approach with browser URL detection.

---

## 8. Plugin / Extensibility Architecture

### TypeWhisper — **First-class, full SDK**

- **Plugin type:** macOS `.bundle` files with `manifest.json`
- **SDK:** `TypeWhisperPluginSDK` — standalone Swift Package
- **Plugin protocols:**
  - `TranscriptionEnginePlugin` — STT engines
  - `LLMProviderPlugin` — LLM providers
  - `TTSProviderPlugin` — TTS providers
  - `PostProcessorPlugin` — text post-processing
  - `ActionPlugin` — app actions (Linear, Obsidian, webhook)
  - `MemoryStoragePlugin` — memory backends
  - `FileJobAutomationPlugin` — post-transcription automation
- **35 first-party plugins** bundled in SDK
- **Plugin registry:** Community plugin marketplace via gh-pages
- **Event bus:** Typed pub/sub for plugin communication
- **Plugin discovery:** BuiltInPlugInsURL + Application Support plugins folder
- **SDK compatibility:** Manifest versioning (`"v1"`)

### Vaani — **No plugin system**

- Zero plugin architecture
- Hard-coded Groq integration
- No extensibility points
- No third-party provider support
- No plugin SDK

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Plugin SDK | ✅ Full SDK (standalone Swift Package) | ❌ None |
| Plugin types | 7 protocol categories | ❌ N/A |
| First-party plugins | 35 bundles | ❌ N/A |
| Community registry | ✅ GitHub Pages-based | ❌ N/A |
| Plugin discovery | ✅ Built-in + Application Support | ❌ N/A |
| Event bus | ✅ Typed pub/sub | ❌ N/A |
| Plugin manifest | ✅ manifest.json with versioning | ❌ N/A |

**Key Insight:** TypeWhisper's plugin architecture is its crown jewel — a full SDK with 7 plugin categories, 35 first-party plugins, and a community registry. This enables infinite extensibility. Vaani has zero extensibility; all functionality is hard-coded.

---

## 9. UI Framework & Windows

### TypeWhisper

- **Framework:** SwiftUI
- **App entry:** MenuBarExtra (no Dock icon, `LSUIElement: true`)
- **Windows:** Settings panels, history window, indicator panels
- **Indicator panels:**
  - NotchIndicatorPanel — mimics MacBook notch
  - OverlayIndicatorPanel — translucent floating overlay
  - MinimalIndicatorPanel — compact dot
- **Dialog windows:** PromptPalettePanel, SelectionPalettePanel, DictationRecoveryView
- **Widgets:** 4 WidgetKit widgets (Chart, History, LastTranscription, Stats)
- **Multilingual:** English + German (`.xcstrings`)
- **Settings window:** Tab-based with 15+ panes
- **Theming:** System light/dark (SwiftUI built-in)
- **View files:** ~41 SwiftUI views

### Vaani

- **Framework:** React 19.1 + Tailwind CSS v4 + shadcn/ui
- **App entry:** Main BrowserWindow (hidden from Dock initially)
- **Windows (3 BrowserWindows):**
  1. **Main window** — Dashboard, History, Snippets, Dictionary, Insights pages
  2. **Overlay window** — `CapsuleOverlay.tsx` floating capsule (6 animated states)
  3. **Recorder window** — Hidden audio capture window
- **Overlay states:** hidden / pressed / recording / processing / done / error / prompt
- **Theme:** Light/dark via `next-themes`, custom accent colors, smooth transitions
- **Fonts:** Bebas Neue (display), DM Sans (body)
- **Animations:** Framer Motion 12 (pulsing dots, waveform bars, spinners, checkmarks)
- **Routing:** React Router DOM 7 (HashRouter)
- **View files:** ~20 TSX files + overlay + recorder

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| UI technology | SwiftUI (native) | React 19 (web) |
| App type | MenuBarExtra (background agent) | Electron window (hybrid) |
| Floating overlay | ✅ 3 styles (Notch, Overlay, Minimal) | ✅ 1 CapsuleOverlay |
| Widgets | ✅ 4 WidgetKit widgets | ❌ No |
| Animated states | SwiftUI animation | ✅ Framer Motion (6 overlay states) |
| Theme | System light/dark | ✅ Custom light/dark + accent colors |
| Multilingual | ✅ en + de (xcstrings) | ❌ English only |
| Settings panes | 15+ panes | 1 settings modal |
| Pages | 1 main view | 5 pages (Dashboard, History, Snippets, Dictionary, Insights) |
| Charts | ❌ No | ✅ Recharts (Insights page) |
| Code size | ~41 view files | ~20 view files + 3 windows |

**Key Insight:** TypeWhisper's UI is deeply native — MenuBarExtra, WidgetKit, and SwiftUI provide seamless macOS integration. Vaani's React UI offers more visual polish (animations, charts, theming) but at the cost of being a web view, with higher memory usage and less native feel.

---

## 10. Speech-to-Text Engines

### TypeWhisper — **10 engines**

| Engine | Type | Languages | Features |
|--------|------|-----------|----------|
| WhisperKit | On-device (Apple Silicon) | 99+ | Streaming, translation, local |
| Parakeet TDT v3 | On-device (Nvidia NeMo) | 25 European | Local |
| SpeechAnalyzer | On-device (macOS 26+) | ~50 | No download needed |
| Granite Speech | On-device (MLX) | ~20 | Local |
| Qwen3 ASR | On-device (MLX) | ~30 | Local |
| Voxtral Mini 4B | On-device (MLX) | ~10 | Local |
| Groq Whisper | Cloud | 99+ | API-based |
| OpenAI Whisper | Cloud | 99+ | API-based |
| xAI/Grok STT | Cloud | ~50 | API-based |
| OpenAI Compatible | Cloud | Varies | Any API |
| Deepgram (SDK) | Cloud | 30+ | API-based |
| AssemblyAI (SDK) | Cloud | 30+ | API-based |
| Google Cloud STT (SDK) | Cloud | 125+ | API-based |
| Soniox (SDK) | Cloud | 30+ | API-based |
| Speechmatics (SDK) | Cloud | 30+ | API-based |
| Gladia (SDK) | Cloud | 30+ | API-based |
| Cloudflare ASR (SDK) | Cloud | 30+ | API-based |

### Vaani — **5 engines (v1.0.4)**

| Engine | Type | Languages | Features |
|--------|------|-----------|----------|
| Groq Whisper (whisper-large-v3-turbo) | Cloud | 99+ | 3 retries, custom vocabulary hints |
| OpenAI Whisper (whisper-1) | Cloud | 99+ | Standard Whisper API |
| Deepgram Nova-2 | Cloud | 30+ | Low-latency, diarization |
| Local whisper.cpp (tiny/base/small) | On-device | 99+ | Fully offline, CoreML accelerated |
| OpenAI-compatible | Cloud | Varies | Any OpenAI-compatible endpoint |

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Total engines | 17 (6 local + 11 cloud) | 5 (1 local + 4 cloud) |
| On-device/local | ✅ 6 (WhisperKit, Parakeet, SpeechAnalyzer, Granite, Qwen3, Voxtral) | ✅ whisper.cpp |
| Streaming | ✅ WhisperKit live partials | ❌ No (full clip) |
| Translation | ✅ WhisperKit translate task | ❌ No |
| Multi-engine fallback | ✅ Yes | ❌ No |
| Offline capability | ✅ Yes (local engines) | ✅ Yes (whisper.cpp) |

**Key Insight:** TypeWhisper supports 17 transcription engines — 6 running entirely on-device and 11 cloud providers. Vaani (v1.0.4) now supports 5 engines including local whisper.cpp for offline use, significantly closing the gap from its previous single-provider state.

---

## 11. Text Processing & Formatting

### TypeWhisper

- **Punctuation:** SpeechPunctuationService + PunctuationVerificationService + PunctuationStrategyResolver + PunctuationRulesLoader
- **Per-profile punctuation profiles** (DictationPunctuationProfileStore)
- **Custom rules:** Loaded from `PunctuationRules/` resources
- **Dictionary:** DictionaryService with auto-learning from manual edits
- **Term packs:** Importable term packs (English + German)
- **Snippets:** SnippetService with placeholders (`{{DATE}}`, `{{TIME}}`, `{{CLIPBOARD}}`)
- **Workflows:** Full workflow system with triggers (app, website, hotkey, global, palette)
- **Prompt boundaries:** Dictated text treated as source, not instructions
- **Post-processing:** PostProcessingPipeline with plugin-based post-processors

### Vaani

- **Cleanup pipeline** (6 steps):
  1. Normalize dictation artifacts ("llmn" → "LLM", remove "Vaani" suffix)
  2. Remove filler words (configurable: um, uh, like, basically, etc.)
  3. Apply custom corrections (user dictionary)
  4. Apply slash-command snippets
  5. Collapse adjacent duplicates (with exemptions)
  6. Capitalize sentences + smart punctuation + normalize whitespace
- **LLM formatting:** Two-pass with 7 sanity checks (see §6)
- **Dictionary suggestions:** Token-level diffing detects corrections → prompts user
- **Snippets:** Slash-command based

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Punctuation engine | Dedicated service with verification | LLM-based + cleanup pipeline |
| Custom rules | ✅ PunctuationRulesLoader | ❌ No |
| Per-profile punctuation | ✅ Yes | ❌ No |
| Filler word removal | ✅ Via post-processor plugins | ✅ Built-in (configurable) |
| Snippets | ✅ Placeholder-based (`{{DATE}}`) | ✅ Slash-command based |
| Dictionary | ✅ Auto-learning from edits | ✅ Manual + suggestion detection |
| Term packs | ✅ Importable (en + de) | ❌ No |
| Workflows | ✅ Full workflow system with triggers | ❌ No |
| Duplicate collapse | ❌ | ✅ With exemptions |
| Smart punctuation | ❌ (relies on LLM/engine) | ✅ Smart quotes, em dash, ellipsis |

**Key Insight:** TypeWhisper's text processing is more modular and configurable — dedicated services, per-profile settings, and plugin-based post-processors. Vaani has a more opinionated but streamlined pipeline with LLM-based punctuation and specific cleanup rules.

---

## 12. Memory & Context

### TypeWhisper

- **MemoryService** with plugin-based backends:
  - FileMemoryPlugin — JSON file storage
  - OpenAIVectorMemoryPlugin — vector search
- **Plugin protocol:** `MemoryStoragePlugin` with `store()`, `search()`, `delete()`, `listAll()`

### Vaani

- **No memory system** — No persistent context, no vector storage, no memory search

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Memory storage | ✅ Plugin-based (file + vector) | ❌ None |
| Vector search | ✅ OpenAI Vector Memory | ❌ None |
| Context persistence | ✅ Yes | ❌ No |

**Key Insight:** TypeWhisper has a memory architecture for long-term context. Vaani has none.

---

## 13. Auto-Update & Licensing

### TypeWhisper

- **Auto-update:** Sparkle framework
  - 3 channels: stable, release-candidate, daily
  - Channel switching in Settings
  - Appcast-based
- **Licensing:** Polar.sh-based LicenseService (~1373 lines)
  - Tiers: Individual, Team, Enterprise (monthly/lifetime)
  - Supporter: Bronze, Silver, Gold
  - Discord claim integration
  - GPLv3 + commercial licenses

### Vaani

- **Auto-update:** `electron-updater` with GitHub provider
  - Checks on startup (packaged builds only)
  - Auto-downloads + installs on quit
  - Single channel (GitHub Releases)
- **Licensing:** MIT (no license enforcement, no tiers)

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Update framework | Sparkle | electron-updater |
| Update channels | 3 (stable/rc/daily) | 1 |
| Licensing | ✅ Polar.sh (3 tiers + supporter) | ❌ MIT (free) |
| Channel switching | ✅ In Settings | ❌ N/A |

**Key Insight:** TypeWhisper has a commercial licensing model with Sparkle-based multi-channel updates. Vaani is free (MIT) with simple electron-updater from GitHub Releases.

---

## 14. CLI & API Surface

### TypeWhisper

- **CLI tool:** `typewhisper-cli/` (4 Swift files)
  - Commands: `status`, `models`, `transcribe <file>`
  - Port discovery via `api-discovery.json`
  - API token auth (bearer token)
  - Stdin support
  - Installed to `/usr/local/bin/typewhisper`
- **HTTP API:** Local REST server on `127.0.0.1:8978`
  - Endpoints: `/v1/status`, `/v1/models`, `/v1/transcribe`, `/v1/history`, `/v1/rules`, `/v1/dictation/start`, `/v1/dictation/stop`
  - Network.framework (NWListener) — no third-party server library

### Vaani

- **No CLI tool**
- **No HTTP API**
- **IPC only:** Electron ipcMain/ipcRenderer between main process and renderers/preloads
- Communication via `IpcChannel` enum

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| CLI | ✅ typewhisper (status, models, transcribe) | ❌ None |
| HTTP API | ✅ /v1/* REST endpoints | ❌ None |
| API token auth | ✅ Bearer token | ❌ N/A |
| Programmatic access | ✅ Full | ❌ None |

**Key Insight:** TypeWhisper provides a complete programmatic API (CLI + HTTP). Vaani is GUI-only, communicating via Electron IPC internally.

---

## 15. Testing

### TypeWhisper

- **Framework:** XCTest (Xcode)
- **Test files:** 35+ Swift test files in TypeWhisperTests/
- **Plugin SDK tests:** Multiple plugin-specific test targets
- **Run command:**
  ```bash
  xcodebuild test -project TypeWhisper.xcodeproj -scheme TypeWhisper -destination 'platform=macOS,arch=arm64'
  swift test --package-path TypeWhisperPluginSDK
  ```

### Vaani

- **Framework:** Vitest v3.1.1
- **Test files:** 7 unit test files
- **Coverage:** cleanup, dictation, dictionarySuggestions, formatting, hotkeys, textInjector
- **Mocks:** Comprehensive Electron API mocks
- **Run command:** `bun test` (also: `bun run typecheck` for tsc --noEmit)

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Framework | XCTest | Vitest |
| Test count | 35+ files | 7 files |
| Mocks | N/A (native) | ✅ Electron mocks |
| Type checking | ✅ Swift 6 strict concurrency | ✅ tsc --noEmit strict |
| CI integration | ❌ (not seen in CI config) | ✅ GitHub Actions |
| Test for key features | Hotkeys, audio, plugins, services | Hotkeys, formatting, text injection, cleanup, dictation |

**Key Insight:** TypeWhisper has more test files but Vaani's tests are more focused on the critical path (hotkeys, formatting, text injection, dictation lifecycle). Both projects test their core functionality adequately.

---

## 16. Permissions & Entitlements

### TypeWhisper (`TypeWhisper.entitlements`)

```xml
com.apple.security.network.client                    ✅
com.apple.security.device.audio-input               ✅
com.apple.security.automation.apple-events           ✅
com.apple.security.cs.disable-library-validation    ✅
com.apple.security.application-groups               ✅
```

- **Info.plist:** `NSMicrophoneUsageDescription`, `NSAppleEventsUsageDescription`

### Vaani (`entitlements.plist`)

```xml
com.apple.security.automation.apple-events              ✅
com.apple.security.cs.allow-jit                        ✅
com.apple.security.cs.allow-unsigned-executable-memory  ✅
com.apple.security.cs.disable-library-validation        ✅
com.apple.security.device.audio-input                   ✅
com.apple.security.device.microphone                    ✅
com.apple.security.accessibility                        ✅
```

### Comparison

| Permission | TypeWhisper | Vaani |
|------------|-------------|-------|
| Microphone | ✅ | ✅ |
| Accessibility | ❌ (via AX APIs, dynamic) | ✅ (entitlement) |
| Apple Events | ✅ | ✅ |
| Network client | ✅ | ❌ (not needed, Electron handles) |
| Disable library validation | ✅ (for plugins) | ✅ (for native modules) |
| Application Groups | ✅ (widgets) | ❌ |
| JIT | ❌ | ✅ (Electron) |
| Unsigned executable memory | ❌ | ✅ (Electron) |
| Accessibility entitlement | ❌ (uses runtime check) | ✅ (static) |

**Key Insight:** Vaani explicitly declares more entitlements (including JIT and unsigned memory for Electron internals). TypeWhisper has Application Groups for widget sharing. Both request microphone and automation permissions.

---

## 17. Privacy & Telemetry

### TypeWhisper

- **PrivacyInfo.xcprivacy:** UserDefaults API only (CA92.1)
- **No tracking, no telemetry**
- Keychain for API keys and license tokens
- Local models keep data on-device
- **Privacy-first design**

### Vaani

- **No telemetry or analytics**
- Audio sent directly to Groq API (no local persistent storage)
- Settings/history stored locally in `~/.vaani/`
- `contextIsolation: true` and `nodeIntegration: false` on all windows
- Content Security Policy via session permission handler
- **Privacy-first design**

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| Telemetry | ❌ None | ❌ None |
| On-device processing | ✅ Yes (local models) | ❌ No (cloud-only) |
| API key storage | ✅ Keychain | ❌ Config file (~/.vaani/settings.json) |
| Privacy manifest | ✅ PrivacyInfo.xcprivacy | ❌ Not needed (Electron) |
| CSP | ❌ | ✅ Session permission handler |

**Key Insight:** Both projects are privacy-first with no telemetry. TypeWhisper has the advantage of on-device processing (audio never leaves the machine). Vaani uses cloud-only processing but has stronger renderer isolation and CSP. TypeWhisper stores API keys in the system Keychain; Vaani stores them in a JSON config file.

---

## 18. CI/CD & Distribution

### TypeWhisper

- **CI:** GitHub Actions (`.github/workflows/`)
- **Distribution channels:**
  - GitHub Releases (nightly/daily)
  - Sparkle appcast (stable/rc)
  - Website download
- **Code signing:** Required (CodeSigning.xcconfig)

### Vaani

- **CI:** GitHub Actions (`.github/workflows/release.yml`)
  - Triggers: tags matching `v*`, manual dispatch
  - Runner: macOS latest
  - Steps: Checkout → npm install → build native → make → upload artifacts
- **Distribution:**
  - GitHub Releases (draft)
  - Auto-update via electron-updater (GitHub provider)
  - DMG + ZIP artifacts + `latest-mac.yml`
- **Code signing:** entitlements.plist with hardened runtime (notarization commented out)

### Comparison

| Feature | TypeWhisper | Vaani |
|---------|-------------|-------|
| CI platform | GitHub Actions | GitHub Actions |
| Build artifacts | .app | DMG + ZIP |
| Release triggers | Multiple channels | Tags + manual |
| Auto-update metadata | Appcast (Sparkle) | latest-mac.yml |
| Notarization | ✅ Yes | ❌ Commented out |
| Update channels | 3 | 1 |

**Key Insight:** Both use GitHub Actions. Vaani uses a simpler single-channel release flow; TypeWhisper has multi-channel distribution with Sparkle.

---

## 19. Summary Table

| Category | TypeWhisper | Vaani |
|----------|-------------|-------|
| **Language** | Swift 6 (native) | TypeScript + C++/Obj-C++ (Electron) |
| **Min macOS** | 14.0 | 12+ |
| **App type** | Background agent (MenuBarExtra) | Electron window (hybrid) |
| **Bundle size** | Likely smaller (native binary) | Larger (Electron + Node) |
| **RAM usage** | Lower (native) | Higher (Chromium) |
| **Hotkeys** | 7 slot types, mouse buttons, per-profile | 2 slots, basic modifier combos |
| **Audio capture** | AVAudioEngine + ScreenCaptureKit | MediaRecorder Web API |
| **System audio** | ✅ Yes (ScreenCaptureKit) | ❌ No |
| **STT engines** | 17 (6 local + 11 cloud) | 5 (1 local + 4 cloud) |
| **LLM providers** | 11 + Apple Intelligence | 4 (Groq, OpenAI, Anthropic, OpenRouter) |
| **Local models** | ✅ WhisperKit, Parakeet, MLX models | ✅ whisper.cpp |
| **Text injection** | AX + clipboard | 5 methods with per-app policy |
| **Plugin system** | ✅ Full SDK (7 protocol categories, 35 plugins) | ❌ None |
| **Widgets** | ✅ 4 WidgetKit widgets | ❌ None |
| **CLI / API** | ✅ CLI + HTTP REST API | ❌ None |
| **Memory system** | ✅ Plugin-based (file + vector) | ❌ None |
| **Licensing** | GPLv3 + Commercial (Polar.sh) | MIT (free) |
| **Auto-update** | Sparkle (3 channels) | electron-updater (1 channel) |
| **Multilingual** | ✅ en + de | ❌ English only |
| **Offline capability** | ✅ Yes (local engines) | ✅ Yes (whisper.cpp) |
| **Extensibility** | ✅ Plugin ecosystem | ❌ Hard-coded |
| **Testing** | 35+ XCTest files | 7 Vitest files |

---

## 20. Architectural Philosophy

### TypeWhisper — "The Powerhouse"

- **Native-first:** Every line of code is crafted for macOS using Swift, SwiftUI, and Apple frameworks
- **Extensible by design:** Plugin SDK, 35 first-party plugins, community registry — users can add any STT or LLM provider
- **Privacy-forward:** 6 local transcription engines keep audio on-device; cloud is optional
- **Commercial quality:** Licensing, multiple update channels, code signing, app groups, widgets
- **Developer-friendly:** CLI, HTTP API, plugin SDK, comprehensive test suite
- **Complexity:** High — ~160+ source files, multiple targets, sophisticated architecture

### Vaani — "The Minimalist, Growing Up"

- **Cross-platform stack:** Electron + React enables faster iteration and potential cross-platform portability
- **Multi-provider flexibility:** 5 STT engines (Groq, OpenAI, Deepgram, local whisper.cpp, OpenAI-compatible) + 4 LLM formatters
- **Offline capable:** Local whisper.cpp transcription works fully offline, no API keys needed
- **Lightweight UX:** Beautiful animated overlay, polished React UI, 5 dashboard pages
- **Smart defaults:** Sophisticated text injection with 5 fallback methods, per-app policies, clipboard safety
- **No extensibility:** Everything is hard-coded — no plugins, no CLI, no API
- **Complexity:** Moderate — ~50 source files, 3 native modules, clean separation of concerns

### Which one to choose?

| If you need... | Choose |
|----------------|--------|
| Offline dictation (no internet required) | Both ✅ |
| Multiple LLM/STT providers | Both (TypeWhisper has more) |
| A plugin ecosystem (extend with custom engines) | **TypeWhisper** |
| Widgets, CLI, HTTP API | **TypeWhisper** |
| Minimal, focused tool with beautiful UI | **Vaani** |
| Wider macOS version support (12+) | **Vaani** |
| Fast iteration / cross-platform future | **Vaani** |
| Per-app text injection policies | **Vaani** |
| Lightweight download / lower memory | **TypeWhisper** |

---

*Report generated by comparative analysis of `typewhisper-mac/` and `Vaani_main/`*
