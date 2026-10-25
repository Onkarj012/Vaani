# Transcription A/B test

This is a dev-only tool. It runs your own recorded clips through each OpenRouter and Groq transcription model and prints how each one did. Use it to pick the default transcription model on your voice.

The clips and results stay in `ab-test/`, which git ignores.

## 1. Record about 30 clips

1. In Vaani, turn on **Save Recordings** in Settings.
2. Dictate. Each dictation saves one WAV file. By default the files go to `~/Documents/Vaani Recordings/`. If you set a different recordings folder in Settings, look there. The names look like `vaani-recording-<timestamp>.wav`.
3. Copy the WAV files into `ab-test/clips/`. Rename each one to say what it is, such as `03-whisper-meeting-notes.wav`.

Cover this mix. Aim for about 30 clips in total:

| Type | Clips | What to say |
| --- | ---: | --- |
| Normal | 6 | Ordinary sentences at your usual pace |
| Quiet | 4 | Speak softly, or away from the mic |
| Whispered | 3 | Whisper a full sentence |
| Names | 4 | People and place names, such as your own name or a colleague's |
| Short terms | 4 | One or two words, such as `Vaani` or `Kubernetes` |
| Repeated words | 3 | `no no no`, `very very good` |
| Negation | 3 | Sentences with `not`, `don't`, `never` |
| Hinglish | 4 | Hindi and English mixed, in Roman or Devanagari |

## 2. Type the reference text

For each clip, make a text file with the same base name:

```
ab-test/clips/03-whisper-meeting-notes.wav
ab-test/clips/03-whisper-meeting-notes.txt
```

Type the words you said. Case and punctuation do not matter. Write Hindi in the script you spoke it in.

If a clip has names or terms that must come out right, add a terms file with the same base name:

```
ab-test/clips/04-names-ananya.terms.txt
```

Put one term per line. A term can have several words. The script checks whether each term appears in the transcript.

## 3. Add the shared hints file (optional)

Create `ab-test/hints.txt` with one term per line. Use the terms from your Vaani dictionary. The script sends these to every model that takes vocabulary hints. The results show whether they went out.

## 4. Run it

Set the key in your own shell. Do not save it in a file in the repo.

```bash
export OPENROUTER_API_KEY=your-key-here
export GROQ_API_KEY=your-key-here
bun scripts/ab-transcription.ts
```

Options:

- `--dir <folder>` uses another folder. The default is `ab-test`.
- `--models <id,id>` runs only some models, for example `--models openai/gpt-transcribe,mistralai/voxtral-mini-transcribe`. Without this flag the script runs every OpenRouter and Groq transcription model in `src/shared/modelList.ts`. Groq gets the hints as its Whisper prompt, the way Vaani sends them.

The script runs one clip at a time, so a full run makes about 30 calls per model. Each run writes two files:

- `ab-test/results/<time>.md`, the table you see in the terminal
- `ab-test/results/<time>.json`, the same numbers plus each transcript and each error

When a new model appears in `src/shared/modelList.ts`, run the script again.

## 5. Read the results

| Column | Meaning |
| --- | --- |
| Failed | Calls that errored. Failed clips count as empty transcripts in the other columns. Check this first. |
| Mean WER | Word error rate. Lower is better. 0% is an exact match. |
| First-word misses | Clips where the first word is wrong. Shown as misses out of the clips, not the failed ones. |
| Last-word misses | The same, for the last word. |
| Term misses | Terms from the terms files that are missing from the transcript. Shown as misses out of all terms. |
| Mean and median latency | Time per call in milliseconds. Failed calls are left out. |
| Total cost | Sum of OpenRouter's reported cost. If OpenRouter sends no cost, the column says so. |
| Hints sent | `yes`, `partial`, or `no`. `no` on a model that takes hints means the hints did not go out. Check that `hints.txt` has terms. |

Pick the model with the lowest WER and the fewest term misses. Break ties on latency and cost. Do not pick a model with many failed calls, even if its other numbers look good.

## 6. Cleanup model bake-off

`scripts/ab-cleanup.ts` runs the same clips through the cleanup (formatting) models. It is dev-only, like the transcription script.

1. Record the 30 lines in [`recording-script.md`](recording-script.md). The file names match the table there.
2. Type each line's **Say** text into `ab-test/clips/<name>.txt`.
   When a note gives a `cleanup input:` override, write it to `<clip>.cleanup.txt`; `ab-cleanup.ts` uses it instead of `<clip>.txt` in reference mode, while transcription scoring keeps the spoken text.
3. Run it:

```bash
export OPENROUTER_API_KEY=your-key-here
export GROQ_API_KEY=your-key-here
export OPENAI_API_KEY=your-key-here
bun scripts/ab-cleanup.ts
```

Options:

- `--models <id,id>` picks models. The default is `anthropic/claude-haiku-5.5` (OpenRouter), `openai/gpt-oss-20b` (Groq), and `gpt-6-luna` (OpenAI). OpenRouter also lists `openai/gpt-6-luna`.
- Every model runs with the test profile from `recording-script.md`, including dictionary, snippets, and extra fillers; `--fillers "like,you know"` adds more.
- `--stt-results ab-test/results/<time>.json --stt-model <id>` cleans the transcripts from `ab-transcription.ts` instead of the typed text.

A model whose key is not set is skipped, and the report says so. The script writes `ab-test/results/cleanup-<time>.md` and `.json`. Stored output and scores use the text Vaani would insert after its final cleanup, for both formatted replies and fallbacks.

| Column | Meaning |
| --- | --- |
| Formatted | The model's reply passed the content guard and was used. |
| Guard rejected | The reply failed the content guard. The app would use the speech-noise fallback instead. |
| Skipped | Vaani does not send lines under four words to the model. The fallback is used. |
| Exact matches | Clips where the text matches the expected cleanup line by line. Case and punctuation count. |
| Mean WER | Word error rate against the expected cleanup. Lower is better. |
| Mean and p90 wait for text to insert | Time until an answer or the fallback is ready, including failed calls and timeouts. Timeouts count the wait up to the deadline. Skipped clips made no call and are excluded. |
| Total cost | All reported OpenRouter cost, including replies with no usable text. Groq and OpenAI do not report cost here. |

## 7. Check cleanup regressions

Keep one reviewed cleanup JSON report as the baseline. After a change, compare another report with the same clip inputs and expected text. The comparison is offline; it never calls a provider or replaces the baseline.

```bash
bun scripts/ab-compare.ts \
  --baseline ab-test/results/cleanup-baseline.json \
  --candidate ab-test/results/cleanup-candidate.json \
  --baseline-model anthropic/claude-haiku-5.5 \
  --candidate-model anthropic/claude-haiku-5.5 \
  --out ab-test/results/comparison.md
```

Model flags can be omitted when each report contains only one model. Reports containing multiple models require explicit selection. `--out` is optional; without it the report goes only to stdout. Output files are created with `0600` permissions. Existing files, including either input, are never overwritten. Keep reports local because they contain transcripts.

The report recomputes scores from final output instead of trusting saved summary numbers. Each clip shows input, expected text, before/after output, exact match, normalized WER, formatter outcome/reason, latency, and cost. It separates score improvements, score regressions, unchanged output, presentation-only changes, and equal-WER word changes needing review. Aggregate gains never hide individual regressions.

Exit codes:

- `0`: no new exact-match loss, WER increase, or failure/timeout. This does **not** approve the output's meaning.
- `1`: at least one clip lost an exact match, increased WER, or newly failed/timed out. The report is still written.
- `2`: invalid arguments, malformed reports, duplicate results, incompatible clip sets/inputs/references, or file errors. No comparison is accepted.

Guard changes are shown for review, not counted as meaning loss by themselves. Latency and cost deltas use only clips with measurements in both runs, with coverage counts. No arbitrary latency/cost threshold is applied.

New cleanup runs record a `configFingerprint` for effective cleanup settings, fixed snippet placeholders, and formatting-prompt source. The comparison requires `--change-note "describe the experiment"` when models, recorded fillers, or fingerprints differ. A note declares an experiment; it does not waive mismatched clips, inputs, or references. Change one factor at a time. Old reports remain readable but show an explicit warning that settings/prompt comparability is unverified. Fingerprints do not establish full production parity or freeze a provider's model implementation.

WER counts normalized word edits, not semantic errors. Punctuation, case, and layout changes can matter for code and meaning even when classified presentation-only. Review changed names, numbers, negations, commands, and omissions before accepting a new baseline. Baseline replacement is a separate manual decision. Freeze references before comparing; if references change, rerun or rescore both sides first.

Run the offline regression checks after script changes:

```bash
bun run test -- tests/unit/abCleanupComparison.test.ts tests/unit/abCleanupScoring.test.ts tests/unit/abScoring.test.ts
```

Paid model reruns are separate from these tests. No scheduler, automatic baseline promotion, or paid CI job is installed.
