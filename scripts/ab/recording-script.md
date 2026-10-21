# Cleanup recording script

Read these 30 lines in Vaani with Save Recordings on. Rename each saved WAV to the file name in the table.

## How to record

1. Read each **Say** line aloud once, at your normal pace. Lines 27 and 28 are whispered.
2. Put each WAV in `ab-test/clips/` under its file name.
3. Make a `.txt` file with the same base name. Type the **Say** text as written, so "$3.50" and "5 p.m." stay as typed. Do not add or remove words.

Example: `ab-test/clips/16-correction-meet-time.wav` and `ab-test/clips/16-correction-meet-time.txt`.

## Expected cleanup

The **Expected cleanup** column is the text a good formatter should output. `scripts/ab-cleanup.ts` scores each model against it.

- A `<br>` in a cell means a new line.
- Lines with fewer than four words skip the cleanup model in Vaani. Vaani then removes only speech noise. Lines 01 and 03 take that path.
- Lines 19 and 20 expect "like" and "you know" to go. Vaani's default filler list is only "um" and "uh", so the model keeps those words unless you add them. Run `ab-cleanup.ts` with `--fillers "like,you know"` to test the full case.

## Lines

| # | File | Say | Expected cleanup | Note |
| --- | --- | --- | --- | --- |
| 01 | `01-short-undo-that.wav` | Undo that. | Undo that. | |
| 02 | `02-short-scroll-top.wav` | Scroll to the top. | Scroll to the top. | |
| 03 | `03-short-stop-recording.wav` | Stop recording now. | Stop recording now. | |
| 04 | `04-short-open-settings.wav` | Open the settings page. | Open the settings page. | |
| 05 | `05-long-release-plan.wav` | So I was thinking we should move the release to next Thursday because the QA team still has two open bugs in the export flow and I do not want to ship with those, so please check with Priya and let me know by tomorrow morning. | So I was thinking we should move the release to next Thursday, because the QA team still has two open bugs in the export flow, and I do not want to ship with those. So please check with Priya and let me know by tomorrow morning. | |
| 06 | `06-long-overlay-bug.wav` | I opened the app this morning and the overlay did not show up when I pressed the hotkey, so I restarted it, and then the hotkey worked for two dictations but after that it stopped again, which looks like the same stuck state we saw last week. | I opened the app this morning and the overlay did not show up when I pressed the hotkey. So I restarted it, and then the hotkey worked for two dictations, but after that it stopped again, which looks like the same stuck state we saw last week. | |
| 07 | `07-long-model-plan.wav` | We finish the transcription test and then pick the default model, after which we update the onboarding copy and ship the build to the three people who asked for it last month. | We finish the transcription test and then pick the default model, after which we update the onboarding copy and ship the build to the three people who asked for it last month. | |
| 08 | `08-number-meeting-time.wav` | Meet me at 5 p.m. at the cafe on MG Road. | Meet me at 5 p.m. at the cafe on MG Road. | |
| 09 | `09-number-money.wav` | The invoice is $3.50 for the extra copy. | The invoice is $3.50 for the extra copy. | |
| 10 | `10-number-file-size.wav` | The backup file is 2.5 GB, so copy it to the external drive first. | The backup file is 2.5 GB, so copy it to the external drive first. | |
| 11 | `11-number-plan-price.wav` | Renew the plan before 31 March, it costs 1,499 rupees. | Renew the plan before 31 March. It costs 1,499 rupees. | |
| 12 | `12-name-priya-groq.wav` | Priya will review the Groq and OpenRouter pricing. | Priya will review the Groq and OpenRouter pricing. | |
| 13 | `13-name-vaani-menu.wav` | Vaani should open in the menu bar after login. | Vaani should open in the menu bar after login. | |
| 14 | `14-name-onkar-build.wav` | Onkar sent the build to Priya, and she is checking it. | Onkar sent the build to Priya, and she is checking it. | |
| 15 | `15-name-claude-md.wav` | Read the rules in CLAUDE.md before you change the README. | Read the rules in CLAUDE.md before you change the README. | |
| 16 | `16-correction-meet-time.wav` | Meet at 3, no wait, 4. | Meet at 4. | |
| 17 | `17-correction-send-to.wav` | Send the report to Priya. Scratch that. Send it to Onkar instead. | Send it to Onkar instead. | needs the self-correction PR (scratch that); on this base the guard rejects it and the fallback keeps all three sentences |
| 18 | `18-correction-fee.wav` | The fee is $30, actually $35. | The fee is $35. | |
| 19 | `19-filler-um-like.wav` | So, um, I think the, like, the export button is too small. | So, I think the export button is too small. | |
| 20 | `20-filler-you-know.wav` | You know, the app feels slow on startup, um, sometimes. | The app feels slow on startup, sometimes. | |
| 21 | `21-question-hotkey.wav` | Can you check whether the hotkey still works after sleep? | Can you check whether the hotkey still works after sleep? | |
| 22 | `22-question-build.wav` | Did the build finish, or did it fail again? | Did the build finish, or did it fail again? | |
| 23 | `23-list-read-aloud.wav` | First, check the microphone. Second, check Accessibility. Third, restart Vaani. | 1. Check the microphone.<br>2. Check Accessibility.<br>3. Restart Vaani. | list |
| 24 | `24-hinglish-meeting.wav` | kal subah ki meeting cancel ho gayi hai, toh please client ko email bhej dena. | Kal subah ki meeting cancel ho gayi hai, toh please client ko email bhej dena. | |
| 25 | `25-hinglish-deploy.wav` | Yaar, the deploy script abhi bhi fail ho raha hai, can you check the logs? | Yaar, the deploy script abhi bhi fail ho raha hai. Can you check the logs? | |
| 26 | `26-hinglish-devanagari.wav` | कल सुबह की meeting cancel हो गई है, तो client को email भेज देना। | Kal subah ki meeting cancel ho gayi hai, toh client ko email bhej dena. | |
| 27 | `27-whisper-pricing.wav` | Do not tell anyone yet, but the pricing page goes live on Friday. | Do not tell anyone yet, but the pricing page goes live on Friday. | whisper |
| 28 | `28-whisper-draft.wav` | Keep your voice low, the baby is sleeping, and send me the draft after lunch. | Keep your voice low, the baby is sleeping, and send me the draft after lunch. | whisper |
| 29 | `29-code-file-path.wav` | Open src/main/transcription.ts and find the formatter call. | Open src/main/transcription.ts and find the formatter call. | code |
| 30 | `30-code-camel-case.wav` | Rename formatTranscriptBlock to formatTranscriptSegment in the transcription service. | Rename formatTranscriptBlock to formatTranscriptSegment in the transcription service. | code |
