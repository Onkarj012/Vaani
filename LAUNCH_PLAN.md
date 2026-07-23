# Vaani — Public Launch Plan

> From a personal macOS app to a real product and brand people trust.

This is a strategy and execution plan — **no code is changed by this document**. It maps what to build, harden, brand, and ship before opening Vaani to the public, and in what order. Items are grouped by theme and then sequenced into phases at the end.

Current baseline (as of v1.1.3):
- macOS-only Electron app, distributed as an unsigned/notarization-optional DMG via GitHub Releases.
- Multi-provider STT (Groq, OpenAI, Deepgram, local whisper.cpp) + LLM formatting (Groq, OpenAI, Anthropic, OpenRouter).
- BYOK model (users paste their own API keys), keys stored in **plain JSON** in `~/.vaani/`.
- No telemetry, no accounts, no website, no legal docs, no crash reporting.
- Known reliability gaps: stale state after ~16h uptime, intermittent capsule overlay.

The gap between "a good app on GitHub" and "a brand for all to use" is mostly **trust, distribution, and reliability** — not more features.

---

## 1. Positioning & Brand Identity

Decide who Vaani is for before polishing anything else — it drives every other decision.

- **Sharpen the positioning.** "Fast, private voice dictation for macOS" is good but crowded (Wispr Flow, Superwhisper, MacWhisper, Aqua). Pick a wedge:
  - *Privacy/offline-first* — "the dictation app that never phones home" (local whisper.cpp is a real differentiator).
  - *Power-user/BYOK* — "bring any provider, own your data, no subscription lock-in."
  - *Per-app intelligence* — the injection/per-app-profiles engine is genuinely differentiated; lean into "works correctly in every app."
  - Recommendation: lead with **privacy + BYOK/no-subscription**, support with **per-app reliability**.
- **Name & trademark.** Confirm "Vaani" is clear to use commercially — trademark search (USPTO + relevant regions), domain availability, npm/GitHub org, and social handles. Have a fallback in case of conflict.
- **Visual identity.** Commission or design: logo (app icon already exists — formalize the system), color palette, typography, and a one-line tagline. Produce a lightweight brand guide so the website, app, and store assets stay consistent.
- **Domain & handles.** Secure `getvaani.com`/`vaani.app` (or similar), plus X/Twitter, a subreddit or Discord, and a GitHub org (`vaani-app`) so the project isn't tied to a personal account.

## 2. Trust, Security & Privacy Hardening

This is the single biggest blocker to public adoption. People install dictation apps that see everything they type; they need to trust it.

- **Code signing + notarization (must-have).** The README's "Vaani is damaged" workaround is fine for hobbyists, fatal for a public brand. Enroll in the Apple Developer Program ($99/yr), configure Developer ID signing + notarization in CI, and staple the ticket. No public launch without this.
- **macOS Keychain for API keys.** Already on the roadmap for v1.1 — promote it to a launch blocker. Plain-JSON key storage is a headline-risk for a "privacy-first" product. Migrate existing keys transparently on upgrade.
- **Publish a real Privacy Policy and clarify the data flow.** You already have `docs/PRIVACY_AND_PROVIDERS.md` — turn it into a hosted, plain-language privacy policy: what's transient, what touches which provider, what never leaves the device in local mode. This is a marketing asset, not just compliance.
- **Third-party / independent review.** Even a lightweight external security review of the injection + native modules buys credibility. Consider a public `SECURITY.md` with a disclosure process and contact.
- **Permissions transparency.** Accessibility + microphone are scary permissions. Add an in-app explainer ("why we need this, what we do and don't do with it") — reduces install abandonment.
- **Supply-chain hygiene.** Enable Dependabot, pin/lock dependencies, and add SBOM generation to the release. Sign releases and publish checksums.

## 3. Reliability & Quality (fix what's already known)

A brand can't ship with "may become unresponsive after ~16 hours" in its own README.

- **Root-cause the stale-state bug.** The watchdog (v1.0.4) is a band-aid. Instrument main-process state, reproduce the long-uptime hang, and fix the root cause. This is currently the most damaging known issue for daily users.
- **Capsule overlay reliability.** Eliminate the intermittent non-appearance rather than relying on retry logic.
- **Short-phrase injection.** "< 3 words may not inject reliably" — fix or clearly bound the behavior per app.
- **Crash & error reporting (opt-in).** Add opt-in Sentry (or self-hosted equivalent) so you learn about failures in the field instead of via GitHub issues. Must be opt-in and clearly disclosed to stay consistent with the privacy stance.
- **Automated QA.** Expand the Vitest suite; add integration smoke tests around injection strategies and provider fallbacks. Add a pre-release manual test matrix (macOS 12→15, Intel + Apple Silicon, common target apps: Slack, Notion, VS Code, Chrome, Mail).
- **Performance budget.** Track and publish cold-start time, transcription latency per provider, and memory footprint — these are your competitive talking points.

## 4. Onboarding & First-Run Experience

The moment that decides retention. Today a new user has to find providers, get keys, grant scary permissions, and guess the hotkey.

- **Guided first-run wizard.** Permissions → provider choice (with "just use offline local mode, zero setup" as the frictionless default) → hotkey confirmation → a "say this sentence" success moment.
- **Zero-key default path.** Ship local whisper.cpp as the default so someone can succeed in 60 seconds without signing up for anything. Cloud is an upgrade, not a prerequisite.
- **In-app help & sample flows.** Tooltips, a "test your setup" button, and a visible indicator of what provider/mode is active.
- **Empty states & recovery.** Clear messaging when a key is invalid, a provider is down, or a permission was revoked — with one-click paths to fix.

## 5. Business Model & Monetization

"A service for all to use" needs a sustainable model. Decide this early because it shapes the architecture.

Options (not mutually exclusive):
- **Free + BYOK (open core).** App is free; users bring their own API keys. Lowest friction, no infra, but no revenue. Good for launch/adoption.
- **One-time license / paid app.** Sell a signed build (e.g., $29–49 one-time) — matches the "no subscription" positioning well. Requires a license-key system and a storefront (Gumroad, Paddle, Lemon Squeezy, or the Mac App Store).
- **Pro subscription.** Recurring revenue for hosted features (managed transcription without BYOK, cloud sync of settings/snippets/history, team features). Requires backend + billing (Stripe/Paddle) and account system.
- **Managed transcription (Vaani-hosted keys).** You proxy to providers and bill usage. Highest value for non-technical users, but now you're an infra + margin + abuse-management business.
- **Recommendation for launch:** free BYOK + **one-time Pro license** for premium features (per-app profiles, cloud sync, priority support). It fits the anti-subscription brand and avoids standing up billing-heavy infra on day one. Layer a subscription later only if hosted features demand it.
- **Mac App Store decision.** MAS gives distribution/trust but sandboxing likely conflicts with the Accessibility/injection model. Plan to stay on **direct distribution (Developer ID + notarized)** as primary; revisit MAS only for a limited-capability edition.

## 6. Distribution & Auto-Update Infrastructure

- **Signed, notarized DMG** as the primary channel (see §2).
- **Homebrew cask** (`brew install --cask vaani`) — expected by the macOS power-user audience and cheap to maintain.
- **Robust auto-updates.** electron-updater is wired to GitHub Releases; verify signature checks, add a staged/rollback path, and a visible changelog in-app. Ensure updates work post-notarization.
- **Release channels.** Stable + optional beta channel so power users can opt into pre-releases and give feedback before GA.
- **Versioning & changelog discipline.** You already keep `CHANGELOG.md` — enforce semver, tag releases, and surface release notes both in-app and on the site.

## 7. Website & Marketing Assets

You currently have no landing page — the biggest missing "brand" surface.

- **Landing page** (`vaani.app`): hero with a short screen-recording of dictation in action, the 3–4 core value props, privacy story, download button, and pricing. Keep it fast and static (Vercel/Netlify/Cloudflare Pages).
- **Demo assets.** A 30–60s hero video and a handful of GIFs (dictating into Slack/Notion/VS Code, offline mode, per-app profiles). This is what converts on Product Hunt/HN.
- **Docs site.** Move usage, permissions, provider setup, and troubleshooting out of the README into a proper docs site (or at least a well-structured `/docs`). Include a "Vaani vs alternatives" comparison — honest, specific.
- **SEO & content.** Target "macos dictation," "offline voice to text mac," "superwhisper alternative," etc. A few high-quality posts (privacy of dictation apps, local whisper on Mac) can drive durable traffic.
- **Social proof scaffolding.** Testimonial capture, a place for reviews, and a public roadmap (see §9).

## 8. Legal & Compliance

- **Privacy Policy** (hosted, see §2) and **Terms of Service** — required before you collect anything or sell licenses.
- **License clarity.** The app is MIT today. Decide whether the public product stays fully open source, moves to open-core (source-available core + proprietary Pro), or closed. This interacts directly with §5 — decide together.
- **Third-party attribution.** You depend on whisper.cpp, Groq/OpenAI/Deepgram/Anthropic SDKs, Electron, etc. Ship a NOTICES/licenses file and honor each license.
- **Provider ToS compliance.** Ensure your usage and any resale/proxy model complies with each provider's terms (especially if you ever host keys).
- **Data-protection posture.** If you ever store user data server-side (accounts, sync), you're in GDPR/CCPA territory — scope this deliberately.

## 9. Support, Community & Feedback

- **Support channel.** At minimum a support email + a triaged GitHub Issues process with templates. Consider Discord for community and fast feedback.
- **Public roadmap & changelog.** A visible roadmap (GitHub Projects or a simple page) signals momentum and invites contribution — you already have a Roadmap section in the README to seed it.
- **Contribution path.** You have `CONTRIBUTING`-style notes in the README and `AGENTS.md`/`CLAUDE.md`; formalize `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` if staying open source.
- **In-app feedback.** A "Send feedback" affordance (opens email/Discord) captures issues you'd otherwise never hear about.

## 10. Analytics & Telemetry (opt-in, privacy-consistent)

- You currently have zero product analytics, which means you're flying blind on what to improve. Add **opt-in, anonymous, self-hostable** analytics (e.g., PostHog EU / Plausible / Aptabase) measuring activation, retention, provider mix, and crash rate — never transcript content.
- Make the privacy guarantee explicit and auditable; this is consistent with the brand if and only if it's opt-in and content-free.

## 11. Feature Roadmap to "Product-Grade"

Beyond the README's v1.1 roadmap, features that move Vaani from "tool" to "product":

- **Settings/snippets/history sync** (drives a Pro tier; requires accounts + backend).
- **Custom vocabulary / dictionary at scale** — names, jargon, code identifiers; per-app.
- **Voice commands & editing** ("new line," "delete that," "select last sentence").
- **Multi-language polish** and language auto-switching per app profile (already partially there).
- **Model management UI** for local whisper (download/manage tiny/base/small, show sizes and speed/accuracy tradeoffs).
- **Accessibility as a first-class use case** — market to users who rely on dictation, not just productivity power users. Big brand and goodwill upside.
- **Cross-platform (later).** Windows is the obvious expansion once macOS is solid; it roughly doubles the market but is a major native-injection lift. Explicitly a post-launch bet, not a launch item.

## 12. Launch Logistics

- **Beta/TestFlight-style program.** Recruit 50–200 beta users (Discord, r/macapps, existing GitHub stars) 4–6 weeks pre-launch. Fix the top issues they surface.
- **Launch surfaces.** Product Hunt (coordinate assets + hunter), Hacker News ("Show HN"), r/macapps and r/apple, relevant newsletters (e.g., macOS/productivity). Prepare copy, demo video, and FAQ in advance.
- **Press/creator outreach.** Short list of macOS-focused YouTubers/bloggers; offer early access + Pro licenses.
- **Launch-day readiness.** Status/monitoring for the download + update endpoints, a staffed support inbox, and a rollback plan if the signed build has issues.
- **Metrics for "did it work."** Define target activation rate, week-1 retention, and crash-free sessions; instrument before launch (§10).

---

## Phased Sequencing

**Phase 0 — Foundations (decide, don't build).** Positioning & wedge (§1), business model + license decision (§5, §8), name/trademark/domains/handles (§1). Everything downstream depends on these.

**Phase 1 — Trust & Reliability (launch blockers).** Apple Developer enrollment, code signing + notarization, Keychain migration (§2); root-cause the stale-state and capsule bugs (§3); Privacy Policy + ToS (§8); opt-in crash reporting (§3). *Do not launch publicly without this phase complete.*

**Phase 2 — Product polish.** First-run wizard + zero-key local default (§4); onboarding/error states; auto-update hardening + Homebrew cask (§6); opt-in analytics (§10).

**Phase 3 — Brand surfaces.** Landing page, demo video/GIFs, docs site, comparison page (§7); support + community channels + public roadmap (§9); visual identity finalized (§1).

**Phase 4 — Monetization plumbing (if paid).** License-key system + storefront (§5); Pro-gated features (sync, per-app profiles).

**Phase 5 — Launch.** Beta program → fix top issues → coordinated Product Hunt / HN / Reddit launch with monitoring and staffed support (§12).

**Post-launch bets.** Cross-platform (Windows), managed/hosted transcription, subscription tier, deeper accessibility features (§5, §11).

---

### The short version
Vaani already has a strong technical core and a clear privacy/BYOK story. The work to become "a brand for all to use" is **80% trust and distribution, 20% new features**: get it signed and notarized, move keys to Keychain, kill the two known reliability bugs, put a real Privacy Policy and landing page in front of it, make first-run effortless with a zero-key local default, decide the money and license question, and launch through a beta into Product Hunt/HN. Features like sync, voice commands, and Windows are the *growth* story — they come after the *trust* story is airtight.
