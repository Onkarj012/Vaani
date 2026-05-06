# Graph Report - .  (2026-04-20)

## Corpus Check
- 95 files · ~55,654 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 336 nodes · 499 edges · 64 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dictation & Injection Core|Dictation & Injection Core]]
- [[_COMMUNITY_UI & Features Doc|UI & Features Doc]]
- [[_COMMUNITY_Clipboard Text Injection|Clipboard Text Injection]]
- [[_COMMUNITY_App Setup & Initialization|App Setup & Initialization]]
- [[_COMMUNITY_Overlay UI Controller|Overlay UI Controller]]
- [[_COMMUNITY_Renderer Hooks & State|Renderer Hooks & State]]
- [[_COMMUNITY_Text Formatting Pipeline|Text Formatting Pipeline]]
- [[_COMMUNITY_Accessibility Text Injection|Accessibility Text Injection]]
- [[_COMMUNITY_History Storage|History Storage]]
- [[_COMMUNITY_Text Cleanup Utilities|Text Cleanup Utilities]]
- [[_COMMUNITY_Dictionary & Suggestions|Dictionary & Suggestions]]
- [[_COMMUNITY_Hotkey Management|Hotkey Management]]
- [[_COMMUNITY_Development Utilities|Development Utilities]]
- [[_COMMUNITY_macOS Audio Session|macOS Audio Session]]
- [[_COMMUNITY_Icon Creation Script|Icon Creation Script]]
- [[_COMMUNITY_Hotkey Capture Component|Hotkey Capture Component]]
- [[_COMMUNITY_Dictation Tests|Dictation Tests]]
- [[_COMMUNITY_Architecture Docs|Architecture Docs]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_Dictionary Page (Theme Variants)|Dictionary Page (Theme Variants)]]
- [[_COMMUNITY_Snippets Page (Theme Variants)|Snippets Page (Theme Variants)]]
- [[_COMMUNITY_Native Build Pipeline|Native Build Pipeline]]
- [[_COMMUNITY_Cleanup Unit Tests|Cleanup Unit Tests]]
- [[_COMMUNITY_History Store Tests|History Store Tests]]
- [[_COMMUNITY_UI Theme Context|UI Theme Context]]
- [[_COMMUNITY_Badge UI Component|Badge UI Component]]
- [[_COMMUNITY_Utility Functions|Utility Functions]]
- [[_COMMUNITY_Monolithic Home Page|Monolithic Home Page]]
- [[_COMMUNITY_Titanium Home Page|Titanium Home Page]]
- [[_COMMUNITY_Aurora Home Page|Aurora Home Page]]
- [[_COMMUNITY_IPC Preload Bridge|IPC Preload Bridge]]
- [[_COMMUNITY_Forge Configuration|Forge Configuration]]
- [[_COMMUNITY_Vite Main Config|Vite Main Config]]
- [[_COMMUNITY_Vite Preload Config|Vite Preload Config]]
- [[_COMMUNITY_Vitest Configuration|Vitest Configuration]]
- [[_COMMUNITY_Vite Renderer Config|Vite Renderer Config]]
- [[_COMMUNITY_Hotkey Unit Tests|Hotkey Unit Tests]]
- [[_COMMUNITY_Dictionary Suggestions Tests|Dictionary Suggestions Tests]]
- [[_COMMUNITY_Formatting Unit Tests|Formatting Unit Tests]]
- [[_COMMUNITY_Text Injector Tests|Text Injector Tests]]
- [[_COMMUNITY_Renderer Entry Point|Renderer Entry Point]]
- [[_COMMUNITY_Slider UI Component|Slider UI Component]]
- [[_COMMUNITY_Switch UI Component|Switch UI Component]]
- [[_COMMUNITY_Separator UI Component|Separator UI Component]]
- [[_COMMUNITY_Button UI Component|Button UI Component]]
- [[_COMMUNITY_Monolithic Settings Page|Monolithic Settings Page]]
- [[_COMMUNITY_Monolithic Layout|Monolithic Layout]]
- [[_COMMUNITY_Monolithic Dashboard Page|Monolithic Dashboard Page]]
- [[_COMMUNITY_Titanium Settings Page|Titanium Settings Page]]
- [[_COMMUNITY_Titanium Layout|Titanium Layout]]
- [[_COMMUNITY_Titanium Dashboard Page|Titanium Dashboard Page]]
- [[_COMMUNITY_Aurora Settings Page|Aurora Settings Page]]
- [[_COMMUNITY_Aurora Layout|Aurora Layout]]
- [[_COMMUNITY_Aurora Dashboard Page|Aurora Dashboard Page]]
- [[_COMMUNITY_Native Hotkey Monitor|Native Hotkey Monitor]]
- [[_COMMUNITY_Native Accessibility Detector|Native Accessibility Detector]]
- [[_COMMUNITY_Native Accessibility Injector|Native Accessibility Injector]]
- [[_COMMUNITY_Defaults Configuration|Defaults Configuration]]
- [[_COMMUNITY_Shared Types|Shared Types]]
- [[_COMMUNITY_IPC Channels Definition|IPC Channels Definition]]
- [[_COMMUNITY_Graphify Context Rules|Graphify Context Rules]]
- [[_COMMUNITY_Build Artifacts Policy|Build Artifacts Policy]]
- [[_COMMUNITY_Package Metadata|Package Metadata]]
- [[_COMMUNITY_Vite Tool Config|Vite Tool Config]]

## God Nodes (most connected - your core abstractions)
1. `DictationService` - 25 edges
2. `OverlayController` - 22 edges
3. `log()` - 14 edges
4. `bootstrap()` - 11 edges
5. `delay()` - 10 edges
6. `ensureTargetReady()` - 10 edges
7. `cleanupText()` - 9 edges
8. `HistoryStore` - 9 edges
9. `Vaani - Premium macOS Voice Dictation` - 8 edges
10. `HotkeyManager` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Text Formatting Module` --conceptually_related_to--> `Smart Text Cleanup`  [INFERRED]
  src/main/formatting.ts → README.md
- `Vaani UI Screenshot` --conceptually_related_to--> `Beautiful UI with Signal & Obsidian Themes`  [INFERRED]
  assets/screenshot.png → README.md
- `Default Configuration Module` --conceptually_related_to--> `Path Aliases for Imports`  [INFERRED]
  src/shared/defaults.ts → CLAUDE.md
- `Shared Type Definitions` --conceptually_related_to--> `Path Aliases for Imports`  [INFERRED]
  src/shared/types.ts → CLAUDE.md
- `React Dependency` --conceptually_related_to--> `React Renderer Entry Point`  [INFERRED]
  package.json → src/renderer/main.tsx

## Hyperedges (group relationships)
- **Text Injection Pipeline** — readme_multiple_injection_methods, readme_accessibility_apis, readme_clipboard_injection, readme_keystroke_simulation [EXTRACTED 1.00]
- **Core Product Features** — readme_global_hotkey_feature, readme_groq_transcription, readme_smart_text_cleanup, readme_multiple_injection_methods [EXTRACTED 1.00]
- **Technology Stack Components** — package_json_electron_dep, package_json_react_dep, package_json_groq_sdk_dep, package_json_tailwindcss_dep [INFERRED 0.90]

## Communities

### Community 0 - "Dictation & Injection Core"
Cohesion: 0.12
Nodes (8): AppDetector, bundleIdToContext(), DictationService, isExternalTarget(), messageForInjectionFailure(), TextInjector, isValidClip(), trimSilence()

### Community 1 - "UI & Features Doc"
Cohesion: 0.08
Nodes (27): No Secrets in Source Code Policy, Tailwind Utility-First Styling, Text Formatting Module, Global CSS Styles, Framer Motion Animation Library, Groq SDK Dependency, Radix UI Component Dependencies, React Dependency (+19 more)

### Community 2 - "Clipboard Text Injection"
Cohesion: 0.19
Nodes (18): ClipboardTextInjector, confirmInsertion(), delay(), ensureTargetReady(), logInjectionStep(), maybeRestoreCaretAfterInsertion(), modifierReleaseLines(), moveCaretToEndForBrowserTarget() (+10 more)

### Community 3 - "App Setup & Initialization"
Cohesion: 0.12
Nodes (12): bootstrap(), createMainWindow(), loadWindowUrl(), log(), showMainWindow(), syncAppPresentation(), registerIpcHandlers(), candidatePaths() (+4 more)

### Community 4 - "Overlay UI Controller"
Cohesion: 0.18
Nodes (2): cleanupRuntimeResources(), OverlayController

### Community 5 - "Renderer Hooks & State"
Cohesion: 0.15
Nodes (9): App(), blobToClip(), calculateRmsFrames(), mixToMono(), resampleToTargetRate(), useAudioRecorder(), useDictation(), useHistory() (+1 more)

### Community 6 - "Text Formatting Pipeline"
Cohesion: 0.22
Nodes (11): countMatches(), formatTranscript(), getClient(), looksSuspicious(), requestFormatting(), shouldFormatText(), stripSpokenCues(), tokenizeForComparison() (+3 more)

### Community 7 - "Accessibility Text Injection"
Cohesion: 0.26
Nodes (10): AccessibilityTextInjector, delay(), normalizeFailureReason(), activateTargetApp(), buildActivateTargetScript(), escapeAS(), internalAppNames(), internalBundleIds() (+2 more)

### Community 8 - "History Storage"
Cohesion: 0.24
Nodes (3): writeJsonFile(), HistoryStore, normalizeHistory()

### Community 9 - "Text Cleanup Utilities"
Cohesion: 0.26
Nodes (10): applyCorrections(), applySmartPunctuation(), capitalizeSentences(), cleanupText(), ensureLinePunctuation(), hasMultipleLines(), isListLine(), normalizeLineWhitespace() (+2 more)

### Community 10 - "Dictionary & Suggestions"
Cohesion: 0.31
Nodes (7): dedupeSuggestions(), detectDictionarySuggestions(), suffixesMatch(), tokenize(), acceptSuggestions(), saveEdit(), startEditing()

### Community 11 - "Hotkey Management"
Cohesion: 0.36
Nodes (3): HotkeyManager, isNativeOnlyAccelerator(), toElectronAccelerator()

### Community 12 - "Development Utilities"
Cohesion: 0.39
Nodes (5): cleanupStaleProcesses(), listStalePids(), processExists(), sleep(), terminatePid()

### Community 13 - "macOS Audio Session"
Cohesion: 0.52
Nodes (6): configureMacOSAudioSession(), getCurrentAudioInputDevice(), hasSwitchAudioSource(), isBluetoothDeviceName(), listAudioInputDevices(), setAudioInputDevice()

### Community 14 - "Icon Creation Script"
Cohesion: 0.8
Nodes (5): build_iconset(), build_square_png(), main(), read_image_dimensions(), run()

### Community 15 - "Hotkey Capture Component"
Cohesion: 0.4
Nodes (2): keyToLabel(), onKeyDown()

### Community 16 - "Dictation Tests"
Cohesion: 0.4
Nodes (0): 

### Community 17 - "Architecture Docs"
Cohesion: 0.5
Nodes (5): Vaani Architecture Summary, Business Logic in Main Process Services, Renderer Components for Presentation Only, Graph-Derived Architecture Summary, Electron Dependency

### Community 18 - "TypeScript Configuration"
Cohesion: 0.4
Nodes (5): Path Aliases for Imports, TypeScript Strict Mode Code Style, Default Configuration Module, TypeScript Dependency, Shared Type Definitions

### Community 19 - "Dictionary Page (Theme Variants)"
Cohesion: 0.5
Nodes (1): handleAdd()

### Community 20 - "Snippets Page (Theme Variants)"
Cohesion: 0.5
Nodes (1): handleAdd()

### Community 21 - "Native Build Pipeline"
Cohesion: 0.5
Nodes (4): Native Build Step Requirement, build:native npm Script, dev npm Script, Node Addon API for Native Modules

### Community 22 - "Cleanup Unit Tests"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "History Store Tests"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "UI Theme Context"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Badge UI Component"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Utility Functions"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Monolithic Home Page"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Titanium Home Page"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Aurora Home Page"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "IPC Preload Bridge"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Forge Configuration"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Vite Main Config"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Vite Preload Config"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Vitest Configuration"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Vite Renderer Config"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Hotkey Unit Tests"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Dictionary Suggestions Tests"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Formatting Unit Tests"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Text Injector Tests"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Renderer Entry Point"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Slider UI Component"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Switch UI Component"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Separator UI Component"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Button UI Component"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Monolithic Settings Page"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Monolithic Layout"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Monolithic Dashboard Page"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Titanium Settings Page"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Titanium Layout"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Titanium Dashboard Page"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Aurora Settings Page"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Aurora Layout"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Aurora Dashboard Page"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Native Hotkey Monitor"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Native Accessibility Detector"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Native Accessibility Injector"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Defaults Configuration"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Shared Types"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "IPC Channels Definition"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Graphify Context Rules"
Cohesion: 1.0
Nodes (1): Graphify Context Rules

### Community 61 - "Build Artifacts Policy"
Cohesion: 1.0
Nodes (1): Do Not Edit Generated Build Artifacts

### Community 62 - "Package Metadata"
Cohesion: 1.0
Nodes (1): Vaani Project Metadata

### Community 63 - "Vite Tool Config"
Cohesion: 1.0
Nodes (1): Vite Build Tool

## Knowledge Gaps
- **25 isolated node(s):** `Accessibility APIs`, `Clipboard Injection`, `Keystroke Simulation`, `Custom Dictionary for Word Replacements`, `Privacy-First Design` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Cleanup Unit Tests`** (2 nodes): `createSettings()`, `cleanup.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `History Store Tests`** (2 nodes): `entry()`, `historyStore.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UI Theme Context`** (2 nodes): `vaani-ui.tsx`, `VaaniUiProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Badge UI Component`** (2 nodes): `Badge()`, `badge.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Utility Functions`** (2 nodes): `utils.js`, `cn()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Monolithic Home Page`** (2 nodes): `MonolithicHomePage()`, `HomePage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Titanium Home Page`** (2 nodes): `TitaniumHomePage()`, `HomePage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aurora Home Page`** (2 nodes): `AuroraHomePage()`, `HomePage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `IPC Preload Bridge`** (2 nodes): `subscribe()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Forge Configuration`** (1 nodes): `forge.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Main Config`** (1 nodes): `vite.main.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Preload Config`** (1 nodes): `vite.preload.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vitest Configuration`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Renderer Config`** (1 nodes): `vite.renderer.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Hotkey Unit Tests`** (1 nodes): `hotkeys.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Dictionary Suggestions Tests`** (1 nodes): `dictionarySuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Formatting Unit Tests`** (1 nodes): `formatting.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Text Injector Tests`** (1 nodes): `textInjector.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Renderer Entry Point`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Slider UI Component`** (1 nodes): `slider.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Switch UI Component`** (1 nodes): `switch.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Separator UI Component`** (1 nodes): `separator.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Button UI Component`** (1 nodes): `button.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Monolithic Settings Page`** (1 nodes): `SettingsPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Monolithic Layout`** (1 nodes): `MonolithicLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Monolithic Dashboard Page`** (1 nodes): `DashboardPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Titanium Settings Page`** (1 nodes): `SettingsPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Titanium Layout`** (1 nodes): `TitaniumLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Titanium Dashboard Page`** (1 nodes): `DashboardPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aurora Settings Page`** (1 nodes): `SettingsPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aurora Layout`** (1 nodes): `AuroraLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Aurora Dashboard Page`** (1 nodes): `DashboardPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Native Hotkey Monitor`** (1 nodes): `hotkey_monitor.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Native Accessibility Detector`** (1 nodes): `detector.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Native Accessibility Injector`** (1 nodes): `injector.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Defaults Configuration`** (1 nodes): `defaults.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Shared Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `IPC Channels Definition`** (1 nodes): `ipc.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Graphify Context Rules`** (1 nodes): `Graphify Context Rules`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Build Artifacts Policy`** (1 nodes): `Do Not Edit Generated Build Artifacts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Package Metadata`** (1 nodes): `Vaani Project Metadata`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Tool Config`** (1 nodes): `Vite Build Tool`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `App Setup & Initialization` to `Dictation & Injection Core`, `Clipboard Text Injection`, `Overlay UI Controller`, `Text Formatting Pipeline`, `Accessibility Text Injection`, `Hotkey Management`, `macOS Audio Session`?**
  _High betweenness centrality (0.174) - this node is a cross-community bridge._
- **Why does `maybeRestoreCaretAfterInsertion()` connect `Clipboard Text Injection` to `App Setup & Initialization`, `Accessibility Text Injection`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `cleanupText()` connect `Text Cleanup Utilities` to `Dictation & Injection Core`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `log()` (e.g. with `.register()` and `formatTranscript()`) actually correct?**
  _`log()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `bootstrap()` (e.g. with `.init()` and `.get()`) actually correct?**
  _`bootstrap()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Accessibility APIs`, `Clipboard Injection`, `Keystroke Simulation` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dictation & Injection Core` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._