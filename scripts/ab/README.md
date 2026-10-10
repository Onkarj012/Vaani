# Transcription A/B test

This is a dev-only tool. It runs your own recorded clips through each OpenRouter transcription model and prints how each one did. Use it to pick the default transcription model on your voice.

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
bun scripts/ab-transcription.ts
```

Options:

- `--dir <folder>` uses another folder. The default is `ab-test`.
- `--models <id,id>` runs only some models, for example `--models openai/gpt-transcribe,mistralai/voxtral-mini-transcribe`. Without this flag the script runs every OpenRouter transcription model in `src/shared/modelList.ts`.

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
