# Vaani design

How the main window looks. UI work follows this file. The overlay capsule is locked separately (`vaani-overlay-approved.html` in the root checkout) and this file doesn't change it.

The reference prototype is `vaani-app-ui-merged.html` (root checkout, untracked). It merges two directions from the 2026-10-27 skill test: "Pastel Studio" as the base, plus the proof view, full-page Settings, graphite status card, toolbar search and recovery alert from "Copydesk".

## Personality

Editorial and warm. Big heavy display type, soft pastel tiles, and dark graphite accents that echo the overlay capsule. Pages show what Vaani did, not only its settings.

## Type

| Use | Font | Class |
|---|---|---|
| Page titles, card titles, big numbers | Cabinet Grotesk 800, tight tracking | `text-display` |
| Body and controls | DM Sans | default |
| Eyebrows, meta lines, counts, keys | Fragment Mono, uppercase, tracked | `label-meta`, `font-mono` |

Sizes: page title 56px, Settings section title 38px, card title 22px, stat number 46px, body 14px, meta 10px.

## Colour

Tokens live in `src/renderer/styles/globals.css`. Use the Tailwind classes, not raw hex, in pages.

- Surfaces: `bg-bg` (window), `bg-side` (sidebar), `bg-card`, `bg-surface` (inputs, inset rows), `bg-graphite` (dark panels).
- Text: `text-ink`, `text-muted`, `text-faint`. On pastel tiles always `text-on-pastel`, which stays dark in both themes.
- Pastels: `chip-lav`, `chip-sky`, `chip-mint`, `chip-blush`, `chip-peach`, `chip-butter`. They deepen one step in dark mode.
- Accent: `accent`, read from Settings › Appearance. Default `#7575c8`.

What each pastel means:

| Pastel | Meaning |
|---|---|
| lav | Primary or selected (how-to hero, selected History row, dictionary editor) |
| butter | Words and suggestions, cleanup rewrites |
| mint | Done, granted, healthy |
| sky | Time, dictionary fixes |
| blush | Snippets, spoken commands |
| peach | Needs you: recovery and failures |

## Shape

- Cards and tiles: `rounded-card` (24px). Inner rows 14 to 20px.
- Buttons, chips, search, segmented controls and nav items are fully round.
- Cards are flat: `border border-line`, no drop shadow. Only the graphite panels and the capsule cast shadows.

## Layout

- Sidebar 236px: brand, Workspace nav (Home, History, Dictionary, Snippets, Insights on ⌘1 to ⌘5), Preferences (Settings on ⌘,), graphite status card, light/dark switch.
- Toolbar: breadcrumb in `label-meta`, a search field (⌘K) that opens History filtered, and a Settings button.
- Content padding is 44px. Home, Dictionary, Snippets and Insights scroll as a page. History and Settings fill the window and scroll their own panes.
- Home is a 12-column bento: lavender how-to hero, four pastel stat tiles, recent dictations, and a side column with the recovery alert and setup.

## Signature pieces

- **Proof view.** History opens on Proof, which marks up what Vaani changed between the raw transcript and the typed text (`src/renderer/lib/proofMarks.ts`). Fillers get an orange strike. "Scratch that" gets a blush strike plus a command chip. Dictionary fixes show the spoken form small and struck on a sky chip. Other rewrites use butter.
- **Capsule.** `components/ui/Capsule.tsx` is a static copy of the overlay pill for illustrations. Don't restyle it on its own; the overlay changes first.
- **Pipeline row.** Settings › API & Providers starts with Hear → Clean → Fix nodes that hold the model pickers.

## Motion

Short colour and background transitions only (150 to 200ms). The capsule waveform animates and stops under reduced motion. No page transitions.
