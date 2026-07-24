# Vaani — Feature Roadmap

> What to build to go from "a very good dictation app" to a product people pay for and tell others about.

Companion to [`LAUNCH_PLAN.md`](./LAUNCH_PLAN.md). That document covers trust, distribution, and brand. **This one covers product** — what Vaani should actually *do* that it doesn't do today.

Every feature below is grounded in the current codebase. Where existing infrastructure makes something cheap to build, that's called out explicitly — several of the highest-value features are mostly-built already and just not exposed.

---

## 0. What already exists (so we don't re-propose it)

The README undersells the app significantly. Already shipped:

- Multi-provider STT (Groq, OpenAI, Deepgram, local whisper.cpp) with **failover** (`failoverEnabled`) and per-provider attempt tracing.
- Multi-provider LLM formatting (Groq, OpenAI, Anthropic, OpenRouter) with **style presets** (`plain | developer | casual | formal | email`).
- **Per-app profiles** (`AppProfile` — provider, language, style, auto-submit, custom prompt per bundle ID). *The README lists this as unbuilt roadmap; it exists.*
- **Transcript quality decisioning** (`TranscriptQualityDecision`: insert/retry/save/reject based on confidence, no-speech probability, logprob, compression ratio).
- **Content guard** with missing-word verification, and **insertion verification with repair** (`InsertionVerificationTrace` — detects partial injection and repairs it). This is genuinely sophisticated; most competitors don't do it.
- Rich **dictation tracing** (`DictationTrace`) + exportable **bug reports**.
- Snippets, custom dictionary with **auto-suggested corrections**, history with re-inject and retry.
- Insights page: words/day, app usage, peak hours, streak.
- VAD + speech gate + native audio capture, device selection, mic pre-warm.
- Auto-updater, onboarding modal, tray, capsule overlay.

**Documentation honesty fix:** the README claims *"5 insertion methods"*, but `InjectionMethod = "ax" | "clipboard"` (`src/shared/types.ts:7`). Reconcile the claim with reality before launch — overclaiming is a trust cost you don't need to pay, especially given how strong the real injection story is.

---

## Tier 1 — Differentiators

These are the features that change what Vaani *is*, not just how well it works. **Build these.** Notably, the first two are largely pre-built and dormant.

### 1.1 Voice editing of selected text ⭐ *highest-value feature in this document*

**What:** Select text anywhere, hold the hotkey, speak an instruction — "make this more formal," "shorten to one sentence," "translate to Hindi," "fix the grammar." The selection is replaced with the transformed result.

**Why it matters:** This is the single biggest feature gap versus Wispr Flow and Superwhisper, and it's the feature people describe when they evangelize those apps. It converts Vaani from *transcription* (a commodity — Whisper is Whisper) into *a writing tool* (defensible, and worth paying for). It also makes the app useful when the user isn't dictating at all, which multiplies daily active usage.

**What already exists:** far more than you'd expect.
- `captureSelection()` at `src/main/dictation.ts:891` already reads the focused selection range on every dictation.
- `nativeBridge.getFocusedSelection()` is wired through `src/main/nativeBridge.ts:22`.
- `injection/index.ts` already accepts `selection?: SelectionRange | null`.
- The full LLM formatting pipeline with custom prompts already exists.

**What's missing:** reading the selected *text* (not just its range) via AX, an intent router (is this speech a dictation or an instruction?), and replace-selection-on-inject. The plumbing is done; the feature isn't exposed.

**Effort:** Medium. **Leverage:** Very high. Do this first.

### 1.2 Streaming / live partial transcription

**What:** Words appear in the capsule overlay as you speak, rather than after you stop.

**Why it matters:** Perceived latency dominates how "fast" a dictation app feels, and it's the most common thing reviewers comment on. It also gives immediate feedback that the mic is live — which incidentally mitigates the capsule-reliability complaint, since users can *see* it working.

**What already exists:** `TranscriptionOptions.streaming?: boolean` is declared at `src/shared/types.ts:316` **and referenced nowhere else in the codebase.** The intent was there; the implementation never landed.

**Notes:** Deepgram has native streaming; whisper.cpp supports incremental decode. Groq/OpenAI batch endpoints don't stream — so this becomes a per-provider capability flag, and a reason for users to pick a streaming provider. Inject only on finalize; stream for display only.

**Effort:** Medium-high (per-provider). **Leverage:** Very high.

### 1.3 Voice commands during dictation

**What:** Spoken control tokens handled deterministically — "new line," "new paragraph," "scratch that," "delete last sentence," "cap that," "all caps," "select all," "send it" (auto-submit).

**Why it matters:** It's the difference between dictating *text* and dictating *a document*. Users currently reach for the keyboard to fix structure, which breaks the hands-free promise. `autoSubmit` already exists on `AppProfile` — "send it" is the natural voice trigger for it.

**Where it goes:** a command layer in `src/main/text/cleanup.ts`, ahead of LLM formatting, so it stays deterministic and provider-independent (never let the LLM decide whether "new line" was a command or content — that's a correctness trap).

**Effort:** Medium. **Leverage:** High. Ship a small, reliable command set rather than a large flaky one.

### 1.4 Undo last injection

**What:** One hotkey reverts the text Vaani just inserted.

**Why it matters:** The scariest moment for a new dictation user is text landing in the wrong place or coming out garbled in someone else's document. A guaranteed undo removes that fear, which measurably improves activation.

**What already exists:** you have *exactly* the data needed — `DictationStageSnapshot.injectedText`, `injectionStrategy`, and `InsertionVerificationTrace` record what was typed, how, and whether it landed. You know the precise string and target.

**Effort:** Low-medium. **Leverage:** High — this is a disproportionate trust win for the effort.

### 1.5 Prompt mode ("ask, don't dictate")

**What:** A second hotkey where speech is treated as an *instruction*, and the model's **answer** is injected at the cursor. "Write a polite decline to this meeting invite." "Give me three subject lines for this."

**Why it matters:** Turns Vaani into an ambient writing assistant available in every macOS text field, with no app-switching and no copy-paste. It's the strongest argument for a paid tier, and it reuses the LLM providers already configured.

**Effort:** Low-medium (the providers, hotkeys, and injection all exist). **Leverage:** High.

### 1.6 On-device LLM formatting

**What:** Local formatting via Apple Foundation Models (macOS 26+) or a small MLX/llama.cpp model, so cleanup and style presets work with zero network.

**Why it matters:** **This is currently a hole in the privacy story.** "Offline mode" (`offlineMode: "always-offline"`) covers STT only — every formatting provider is cloud. A user in `always-offline` mode with formatting enabled either silently loses formatting or leaks text to a provider. For a product whose primary wedge is privacy, "fully offline, end to end" needs to be literally true.

**Effort:** Medium-high. **Leverage:** High — it makes the headline marketing claim defensible.

---

## Tier 2 — Depth and parity

Table stakes, or cheap wins that reuse the existing pipeline.

### 2.1 Audio file transcription
Drag a `.mp3`/`.m4a`/`.wav` (a meeting recording, a voice memo, an interview) onto Vaani and get a transcript. **Very low effort** — the entire STT pipeline, provider registry, and chunking already exist; this is a new input source, not new machinery. High utility, immediately demoable, and a strong landing-page GIF.

### 2.2 Long-form / meeting mode
Extended recording with chunking (`chunkCount`/`chunkDurationsSeconds` already exist in `TranscriptionQualityMetadata`), plus an LLM pass for summary and action items. Natural pairing with 2.1 and with diarization below.

### 2.3 Speaker diarization
Deepgram supports it natively. Only meaningful alongside 2.1/2.2, but it's what makes meeting transcripts actually readable.

### 2.4 Vocabulary priming (not just post-hoc correction)
Today, custom vocabulary is applied as **corrections after** transcription (`customCorrections`). Whisper accepts a `prompt` to bias decoding *before* it happens — and `TranscriptionOptions.prompt` already exists but isn't fed by the user's dictionary. Priming the model with the user's names, jargon, and code identifiers fixes errors at the source instead of patching them. **Low effort, meaningful accuracy gain.**

Extend with: bulk import, macOS Contacts import (names are the #1 error class), and per-app vocabulary.

### 2.5 Cost and usage tracking
BYOK users pay per API call and currently have **zero visibility** into spend. Show cost per provider per month, derived from audio duration and token counts. Traces already record provider and latency — cost is a small extension. This is strongly on-brand for the BYOK/anti-subscription positioning and nobody else does it well.

### 2.6 Provider benchmarking + auto-select
You already store `providerAttempts` with per-provider latency, success, and quality metadata — and show none of it. Surface "Groq: 1.2s avg · Deepgram: 0.8s · local: 3.1s" and offer "automatically use the fastest available." This turns existing telemetry into a visible feature at near-zero cost, and makes the multi-provider architecture *legible* to users instead of a settings-page chore.

### 2.7 Noise suppression
You have `vad.ts` and `speechGate.ts`; add spectral noise reduction for cafés, fans, and open offices. Directly improves accuracy in the environments where users complain most.

### 2.8 Local whisper model manager
Download/manage tiny/base/small with visible size, speed, and accuracy tradeoffs. Required to make "offline by default" (see `LAUNCH_PLAN.md` §4) a usable onboarding path rather than a settings-page scavenger hunt.

---

## Tier 3 — Platform and ecosystem

Cheap, high affinity with the macOS power-user audience, and each one is a distribution channel as much as a feature.

- **3.1 macOS Shortcuts actions + URL scheme** (`vaani://dictate?profile=email`) — makes Vaani automatable and composable. Low effort, high geek appeal.
- **3.2 CLI** (`vaani dictate`, `vaani transcribe file.mp3`) — natural given the developer-leaning audience, and pairs with the `developer` style preset that already exists.
- **3.3 Raycast extension / Alfred workflow** — these are *distribution*, not just integration. Raycast's store is a genuine discovery surface for exactly this user.
- **3.4 Menu bar quick actions** — the tray is only 188 lines today. Add recent dictations, one-click provider/profile switch, and pause. Cheap polish that makes the app feel present.
- **3.5 Browser-extension bridge** — AX injection is weak in web apps, and Google Docs in particular is notoriously hostile. An extension is the only reliable path there, and Docs is a top-5 destination for dictated text.
- **3.6 Local HTTP/IPC endpoint** — let other apps and scripts push audio and receive text. Enables the community to build on Vaani.

---

## Tier 4 — Pro tier / monetizable

These justify the one-time Pro license (or subscription) proposed in `LAUNCH_PLAN.md` §5. Each requires accounts and a backend — sequence them **after** the trust and reliability work.

- **4.1 Sync** — settings, snippets, dictionary, and history across Macs. The most-requested paid feature in this category and the natural first Pro gate.
- **4.2 Shared team dictionaries and snippets** — company jargon, product names, house style. The wedge into team sales.
- **4.3 Managed transcription** — Vaani-hosted keys for users who won't ever create a Groq account. Expands the addressable market past the technical audience, at the cost of running margin and abuse management.
- **4.4 Admin, SSO, and audit** — only if teams gain traction; don't build ahead of demand.

---

## Tier 5 — Long bets

- **5.1 Windows** — roughly doubles the market; a major native-injection lift (the AX/injection layer is entirely macOS). Post-launch, and only once macOS is genuinely solid.
- **5.2 iOS companion** — capture on phone, sync to desktop; also a credible standalone keyboard.
- **5.3 Real-time translation dictation** — speak Hindi, type English. Strong differentiator for a large non-US market, and it fits the multilingual work already done (Hinglish handling, language auto-detect).
- **5.4 Wake word / fully hands-free** — the gateway to the accessibility market.
- **5.5 Accessibility as a first-class product** — dwell control, switch access, full hands-free operation. This is both a real underserved market and a meaningful brand asset. Worth taking seriously rather than treating as a checkbox.

---

## Prioritization

Ranked by leverage-to-effort, accounting for what's already built:

| # | Feature | Effort | Leverage | Notes |
|---|---------|--------|----------|-------|
| 1 | Voice editing of selection (1.1) | Med | ★★★★★ | Infra ~70% built and dormant |
| 2 | Audio file transcription (2.1) | Low | ★★★★ | Pipeline fully reusable |
| 3 | Undo last injection (1.4) | Low-Med | ★★★★ | Trace data already sufficient |
| 4 | Provider benchmarking (2.6) | Low | ★★★ | Data collected, never surfaced |
| 5 | Vocabulary priming (2.4) | Low | ★★★ | `prompt` field exists, unused |
| 6 | Streaming transcription (1.2) | Med-High | ★★★★★ | Dead `streaming` flag |
| 7 | Voice commands (1.3) | Med | ★★★★ | Keep deterministic |
| 8 | Prompt mode (1.5) | Low-Med | ★★★★ | Reuses LLM providers |
| 9 | Cost tracking (2.5) | Low-Med | ★★★ | On-brand for BYOK |
| 10 | On-device formatting (1.6) | Med-High | ★★★★ | Closes the privacy gap |

**Recommended sequencing**, interleaved with `LAUNCH_PLAN.md`:

- **Pre-launch (with Phase 2 polish):** the cheap wins that make the app demo well — audio file transcription, undo, provider benchmarking, vocabulary priming, and local model manager. All low-effort, all reuse existing machinery.
- **Launch differentiator:** ship **voice editing of selection** as the headline feature. It's what the launch post is *about*. "Vaani doesn't just type what you say — it edits what you've written."
- **Fast-follow (v1.2–1.3):** streaming, voice commands, prompt mode, cost tracking.
- **Privacy completion (v1.3+):** on-device formatting, closing the offline gap.
- **Pro tier (post-monetization decision):** sync, then teams.
- **Long bets:** Windows, translation, accessibility.

---

### The short version

Vaani's engine is stronger than its surface area — quality decisioning, insertion verification with repair, per-app profiles, and full tracing are all built and largely invisible to users. **Three features are sitting half-finished in the codebase** (selection capture, the `streaming` flag, the unused `prompt` field), and the most valuable feature in this entire document is the one whose plumbing you already wrote.

The strategic move: **stop competing on transcription** (Whisper is a commodity; everyone has the same models) **and start competing on what happens to the text afterward** — editing, commands, prompting, and per-app intelligence. That's where the moat is, it's where subscriptions are being charged today, and it's the shortest path from your current code to a product people describe to their friends.
