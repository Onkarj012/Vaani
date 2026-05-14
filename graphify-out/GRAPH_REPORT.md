# Graph Report - /Users/onkarj012/Projects/Alternatives/claude_vaani  (2026-05-13)

## Corpus Check
- 87 files · ~59,365 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 435 nodes · 737 edges · 77 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 145 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]

## God Nodes (most connected - your core abstractions)
1. `OverlayController` - 34 edges
2. `DictationService` - 31 edges
3. `isDestroyed()` - 21 edges
4. `bootstrap()` - 18 edges
5. `log()` - 15 edges
6. `HotkeyManager` - 14 edges
7. `cleanupText()` - 12 edges
8. `RecorderWindowController` - 11 edges
9. `ensureTargetReady()` - 10 edges
10. `HistoryStore` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Beautiful UI with Signal & Obsidian Themes` --conceptually_related_to--> `Vaani UI Screenshot`  [INFERRED]
  README.md → assets/screenshot.png
- `registerIpcHandlers()` --calls--> `bootstrap()`  [INFERRED]
  /Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/ipc.ts → /Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/index.ts
- `Groq API Key Configuration` --rationale_for--> `No Secrets in Source Code Policy`  [INFERRED]
  README.md → CLAUDE.md
- `Vaani Architecture Summary` --conceptually_related_to--> `Graph-Derived Architecture Summary`  [INFERRED]
  CLAUDE.md → graphify-out/GRAPH_REPORT.md
- `loadURL()` --calls--> `loadWindowUrl()`  [INFERRED]
  /Users/onkarj012/Projects/Alternatives/claude_vaani/tests/__mocks__/setup.ts → /Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/index.ts

## Hyperedges (group relationships)
- **Text Injection Pipeline** — readme_multiple_injection_methods, readme_accessibility_apis, readme_clipboard_injection, readme_keystroke_simulation [EXTRACTED 1.00]
- **Core Product Features** — readme_global_hotkey_feature, readme_groq_transcription, readme_smart_text_cleanup, readme_multiple_injection_methods [EXTRACTED 1.00]
- **Technology Stack Components** — package_json_electron_dep, package_json_react_dep, package_json_groq_sdk_dep, package_json_tailwindcss_dep [INFERRED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (11): showMainWindow(), syncAppPresentation(), log(), OverlayController, focus(), isDestroyed(), setAlwaysOnTop(), setBounds() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (9): AppDetector, bundleIdToContext(), DictationService, isExternalTarget(), messageForInjectionFailure(), sameTarget(), TextInjector, isValidClip() (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (17): ClipboardTextInjector, confirmInsertion(), delay(), ensureTargetReady(), maybeRestoreCaretAfterInsertion(), modifierReleaseLines(), moveCaretToEndForBrowserTarget(), prefersSystemEventsPaste() (+9 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (10): AppRoot(), RendererErrorBoundary, blobToClip(), calculateRmsFrames(), mixToMono(), resampleToTargetRate(), useAudioRecorder(), useDictation() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (13): armMainWindowReadyTimeout(), bootstrap(), cleanupRuntimeResources(), clearMainWindowReadyTimeout(), configureMediaPermissions(), configureRendererLifecycle(), createMainWindow(), isDictationActive() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (14): calculateFirstSentenceOverlap(), firstSentence(), formatTranscript(), getClient(), hasLeadWordOverlap(), hasOrderedTokenPreservation(), looksSuspicious(), requestFormatting() (+6 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (18): No Secrets in Source Code Policy, Accessibility APIs, Beautiful UI with Signal & Obsidian Themes, Clipboard Injection, Custom Dictionary for Word Replacements, Default Hotkey Ctrl+Option+D, Global Hotkey Feature, Groq API Key Configuration (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (13): blobToClip(), calculateRmsFrames(), chooseMicDevice(), cleanup(), mixToMono(), preferredMimeType(), reportFailure(), resampleToTargetRate() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.25
Nodes (3): HotkeyManager, isNativeOnlyAccelerator(), toElectronAccelerator()

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (6): candidatePaths(), getNativeBridge(), loadNativeAddon(), RecorderWindowController, loadFile(), loadURL()

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (13): applyCorrections(), applySmartPunctuation(), applySnippets(), capitalizeSentences(), cleanupText(), collapseAdjacentDuplicateWords(), ensureLinePunctuation(), hasMultipleLines() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (9): refreshPermissions(), requestAccessibility(), ThemeToggle(), VaaniIcon(), getPermissionStatus(), normalizeMediaStatus(), openPermissionSettings(), registerIpcHandlers() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.26
Nodes (10): AccessibilityTextInjector, delay(), normalizeFailureReason(), activateTargetApp(), buildActivateTargetScript(), escapeAS(), internalAppNames(), internalBundleIds() (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (3): writeJsonFile(), HistoryStore, normalizeHistory()

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (3): computeAppUsageData(), computeHourlyData(), SettingsStore

### Community 15 - "Community 15"
Cohesion: 0.39
Nodes (5): cleanupStaleProcesses(), listStalePids(), processExists(), sleep(), terminatePid()

### Community 16 - "Community 16"
Cohesion: 0.52
Nodes (6): configureMacOSAudioSession(), getCurrentAudioInputDevice(), hasSwitchAudioSource(), isBluetoothDeviceName(), listAudioInputDevices(), setAudioInputDevice()

### Community 17 - "Community 17"
Cohesion: 0.8
Nodes (5): build_iconset(), build_square_png(), main(), read_image_dimensions(), run()

### Community 18 - "Community 18"
Cohesion: 0.5
Nodes (2): keyToLabel(), onKeyDown()

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.7
Nodes (4): dedupeSuggestions(), detectDictionarySuggestions(), suffixesMatch(), tokenize()

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (4): Vaani Architecture Summary, Business Logic in Main Process Services, Renderer Components for Presentation Only, Graph-Derived Architecture Summary

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): Path Aliases for Imports, TypeScript Strict Mode Code Style

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): Graphify Context Rules

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): Tailwind Utility-First Styling

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): Native Build Step Requirement

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): Do Not Edit Generated Build Artifacts

## Knowledge Gaps
- **17 isolated node(s):** `Smart Text Cleanup`, `Accessibility APIs`, `Clipboard Injection`, `Keystroke Simulation`, `Custom Dictionary for Word Replacements` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 25`** (2 nodes): `createSettings()`, `cleanup.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `createDictationService()`, `dictation.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `walk()`, `generate-latest-mac-yml.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `vaani-ui.tsx`, `VaaniUiProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `handleExportData()`, `SettingsModal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `cn()`, `api-key-input.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `cn()`, `Kbd.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `Badge()`, `badge.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `LiveWaveform()`, `live-waveform.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `Skeleton()`, `Skeleton.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `utils.js`, `cn()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `handleAdd()`, `Dictionary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `StatSkeleton()`, `Dashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `subscribe()`, `recorder.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `subscribe()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `Path Aliases for Imports`, `TypeScript Strict Mode Code Style`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `forge.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `vite.recorder-preload.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `vite.overlay-preload.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `vite.main.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `vite.preload.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `vite.overlay.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `vite.recorder.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `vite.renderer.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `electron.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `electron.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `hotkeys.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `dictionarySuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `formatting.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `dictation.fixture.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `textInjector.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `App.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `slider.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `switch.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `separator.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `button.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `dropdown-menu.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `CapsuleOverlay.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `hotkey_monitor.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `detector.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `injector.mm`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `defaults.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `ipc.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `overlay.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `Graphify Context Rules`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `Tailwind Utility-First Styling`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `Native Build Step Requirement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `Do Not Edit Generated Build Artifacts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 8`, `Community 9`, `Community 12`, `Community 16`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `bootstrap()` connect `Community 4` to `Community 0`, `Community 11`, `Community 14`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `maybeRestoreCaretAfterInsertion()` connect `Community 2` to `Community 4`, `Community 12`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 20 inferred relationships involving `isDestroyed()` (e.g. with `showMainWindow()` and `syncAppPresentation()`) actually correct?**
  _`isDestroyed()` has 20 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `bootstrap()` (e.g. with `.init()` and `.hide()`) actually correct?**
  _`bootstrap()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `log()` (e.g. with `.register()` and `formatTranscript()`) actually correct?**
  _`log()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Smart Text Cleanup`, `Accessibility APIs`, `Clipboard Injection` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._