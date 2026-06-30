# Privacy and Providers

Vaani is a bring-your-own-key dictation app. It can run fully local transcription with Local Whisper, or use cloud transcription and formatting providers when you configure API keys.

## What Stays Local

- Hotkeys, app profiles, dictionary entries, snippets, settings, and history are stored locally.
- Audio diagnostics, quality decisions, traces, and saved recording paths stay local unless you export or share a bug report.
- Local Whisper transcription processes audio on device.
- Dictionary and snippet learning are local by default.

## What Goes to Providers

Cloud transcription providers receive the recorded audio clip for each dictation they process:

- Groq Whisper
- OpenAI Whisper
- Deepgram
- OpenAI-compatible transcription endpoints

Cloud formatting providers receive transcript text when formatting is enabled and a configured provider is available:

- Groq Llama
- OpenAI GPT
- Anthropic Claude
- OpenRouter

Context awareness is off by default. When enabled, Vaani may use bounded app/style context for formatting, but it should not send full document contents.

## Offline and Hybrid Modes

- `always-offline`: only Local Whisper is used. If the local module or model is unavailable, dictation fails clearly instead of falling back to cloud.
- `always-online`: only cloud transcription providers are used. Local Whisper is excluded from the fallback chain.
- `auto`: the selected provider is tried first. When failover is enabled, Vaani can try configured cloud fallbacks and then Local Whisper.

## Cost and Confidence

Settings labels show whether a provider is cloud or local, the rough cost class, privacy level, and whether the provider returns confidence-style metadata. Vaani stores confidence, no-speech probability, logprob, compression ratio, segment counts, and quality decisions in local traces when providers expose those fields.

## Exports and Bug Reports

Exports and bug reports should not include API keys. They may include history text, local trace metadata, and recording file paths when recordings are enabled. Treat exported reports as user-controlled diagnostic bundles and review them before sharing.
