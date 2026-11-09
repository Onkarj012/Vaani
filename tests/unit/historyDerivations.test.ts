import { describe, expect, it, vi } from "vitest";
import type { DictationEntry } from "@shared/types";
import { mapHistoryItems } from "@renderer/context/vaani-ui";
import { createRecoveryActionRunner, deriveRecoveryActions, deriveRecoveryItem, dedupeRecoveryEntries, matchesRecoverySearch } from "@renderer/lib/recoveryDerivations";
import { createRecoveryEntry, toRecoveryEntryView, type RecoveryEntry, type RecoveryErrorClass } from "@shared/recovery";
import {
  computeEntryFacts,
  createHistoryHaystack,
  deriveStats,
  deriveStreak,
  deriveWeeklyActivity,
  mapDictionaryItems,
} from "@renderer/lib/historyDerivations";

function entry(
  id: string,
  date: Date,
  text: string,
  injectionStatus: "injected" | "saved" = "injected"
): DictationEntry {
  return {
    id,
    timestamp: date.toISOString(),
    rawText: text,
    formattedText: text,
    cleanedText: text,
    durationSeconds: 1,
    appBundleId: null,
    appName: null,
    injectionStatus,
    injectionMethod: injectionStatus === "injected" ? "clipboard" : null,
    language: "en",
  };
}

describe("history derivations", () => {
  const now = new Date(2026, 5, 16, 12);
  const entries = [
    entry("today-1", new Date(2026, 5, 16, 9), "hello world", "injected"),
    entry("today-2", new Date(2026, 5, 16, 10), "ship the update", "saved"),
    entry("yesterday", new Date(2026, 5, 15, 10), "one two three four", "injected"),
    entry("older", new Date(2026, 5, 13, 10), "old words", "injected"),
  ];

  it("derives stats from precomputed entry facts", () => {
    const facts = computeEntryFacts(entries);

    expect(deriveStats(facts, now)).toEqual({
      wordsToday: 5,
      sessionsToday: 2,
      streak: 2,
      accuracy: 75,
      totalWords: 11,
      totalSessions: 4,
    });
  });

  it("derives seven weekly buckets with matching word sums", () => {
    const activity = deriveWeeklyActivity(computeEntryFacts(entries), now);

    expect(activity).toHaveLength(7);
    expect(activity.map((item) => item.words)).toEqual([0, 0, 0, 2, 0, 4, 5]);
    expect(activity.at(-1)?.day).toBe("Tue");
  });

  it("returns zero streak when there is no entry today", () => {
    const facts = computeEntryFacts([
      entry("yesterday", new Date(2026, 5, 15, 10), "one two", "injected"),
    ]);

    expect(deriveStreak(facts, now)).toBe(0);
  });

  it("counts dictionary item usage with word-boundary matching", () => {
    const haystack = createHistoryHaystack([
      entry("one", now, "Open GitHub and then open github", "injected"),
      entry("two", now, "githubish is not a match", "injected"),
    ]);

    expect(mapDictionaryItems([
      { spoken: "github", written: "GitHub" },
      { spoken: "", written: "Blank" },
    ], haystack)).toEqual([
      {
        id: 1,
        word: "github",
        pronunciation: null,
        category: "Correction",
        replacement: "GitHub",
        usageCount: 2,
      },
      {
        id: 2,
        word: "",
        pronunciation: null,
        category: "Correction",
        replacement: "Blank",
        usageCount: 0,
      },
    ]);
  });

  it("carries detected language into the history presentation model", () => {
    const mapped = mapHistoryItems([{
      ...entry("detected", now, "namaste world"),
      detectedLanguage: "hi",
      language: null,
    }]);

    expect(mapped[0]).toMatchObject({ language: null, detectedLanguage: "hi" });
  });

  it("derives bounded recovery previews and only state-valid actions", () => {
    const entry = toRecoveryEntryView({
      ...createRecoveryEntry({ id: "recovery-1", sessionId: "session-1", buildIdentifier: "test" }, new Date("2026-06-16T10:00:00.000Z")),
      state: "recoverable",
      text: { rawTranscript: "word ".repeat(200), cleanedText: null, formattedText: null },
      audio: { kind: "encrypted-session-file", path: "/private/recovery.enc", durationSeconds: 2 },
      insertion: {
        status: "failed",
        outcome: "recoverable",
        method: "clipboard",
        reason: "insertion_failed",
        detail: "bounded detail",
        targetFingerprint: { appBundleId: "com.example.Editor", appName: "Editor", windowTitle: "Secret window" },
        appIdentity: { appBundleId: "com.example.Editor", appName: "Editor", windowTitle: "Secret window" },
        baselineReadable: true,
        baselineHash: "baseline-secret",
        textHash: "text-secret",
        intendedStrategy: "clipboard",
        deadlineAt: "2026-06-16T12:01:00.000Z",
      },
      providerAttempts: [{
        attempt: 1,
        provider: "groq",
        startedAt: "2026-06-16T10:00:00.000Z",
        completedAt: "2026-06-16T10:00:01.000Z",
        deadlineAt: null,
        outcome: "failed",
      }],
      lastError: { class: "transcription_error", detail: "provider failed" },
    });
    const item = deriveRecoveryItem(entry, new Date("2026-06-16T12:00:00.000Z"));
    expect(item.preview.length).toBeLessThanOrEqual(180);
    expect(matchesRecoverySearch(item, "word")).toBe(true);
    expect(item.age).toBe("2 hours ago");
    expect(item.actions).toEqual(expect.arrayContaining(["retry-transcription", "retry-formatting", "retry-insertion", "copy", "play-audio", "delete-audio", "discard"]));
    expect(entry.text.rawTranscript).toBe("word ".repeat(200));
    expect(deriveRecoveryActions({ ...entry, state: "delivered", terminal: "delivered" })).toEqual([]);
    expect(dedupeRecoveryEntries([entry, entry])).toHaveLength(1);
    expect(JSON.stringify(entry)).not.toContain("recovery.enc");
    expect(JSON.stringify(entry)).not.toContain("Secret window");
    expect(JSON.stringify(entry)).not.toContain("baseline-secret");
    expect(JSON.stringify(entry)).not.toContain("groq");
    expect(entry.insertion).toEqual({
      status: "failed",
      outcome: "recoverable",
      method: "clipboard",
      reason: "insertion_failed",
      detail: "bounded detail",
    });

    const audioExpired = {
      ...entry,
      audioAvailable: false,
      audioDurationSeconds: null,
      retention: {
        ...entry.retention,
        audioExpiresAt: "2026-06-16T11:00:00.000Z",
        expiresAt: "2026-06-17T10:00:00.000Z",
      },
    };
    const expiredItem = deriveRecoveryItem(audioExpired, new Date("2026-06-16T12:00:00.000Z"));
    expect(expiredItem.status).toBe("The recording expired. The text is still here.");
    expect(expiredItem.actions).toEqual(expect.arrayContaining(["copy", "retry-insertion"]));
    expect(expiredItem.actions).not.toEqual(expect.arrayContaining(["retry-transcription", "play-audio", "delete-audio"]));
  });

  it("searches full recovery text and hides Use raw when formatted text exists", () => {
    const entry = toRecoveryEntryView({
      ...createRecoveryEntry({ id: "search", sessionId: "search", buildIdentifier: "test" }),
      state: "text_ready",
      text: { rawTranscript: `${"a".repeat(200)} hidden-term`, cleanedText: null, formattedText: "formatted text" },
    });
    const item = deriveRecoveryItem(entry);
    expect(item.preview).not.toContain("hidden-term");
    expect(matchesRecoverySearch(item, "hidden-term")).toBe(true);
    expect(matchesRecoverySearch(deriveRecoveryItem({ ...entry, text: { rawTranscript: null, cleanedText: null, formattedText: null } }), "")).toBe(true);
    expect(deriveRecoveryActions(entry)).not.toContain("use-raw-transcript");
    expect(deriveRecoveryActions({ ...entry, text: { ...entry.text, formattedText: null } })).toContain("use-raw-transcript");
  });

  it("says what failed and what to do next, in full words", () => {
    const now = new Date("2026-06-16T12:00:00.000Z");
    const base = createRecoveryEntry({
      id: "copy",
      sessionId: "copy",
      buildIdentifier: "test",
      createdAt: "2026-06-16T10:00:00.000Z",
    });
    const item = (patch: Partial<RecoveryEntry>, at = now) => deriveRecoveryItem(toRecoveryEntryView({ ...base, ...patch }), at);

    expect(item({
      state: "recoverable",
      lastError: { class: "transcription_error" },
      audio: { kind: "encrypted-session-file", path: "/tmp/a.enc" },
      text: { rawTranscript: "hello", cleanedText: null, formattedText: null },
    }).status).toBe("Transcription didn't finish. Retry, or copy any text that was saved.");
    expect(item({
      state: "recoverable",
      recoveryMode: "text-only",
      lastError: { class: "transcription_error" },
      text: { rawTranscript: "hello", cleanedText: null, formattedText: null },
    }).status).toBe("Transcription didn't finish, and the recording wasn't kept. Copy any text that was saved.");
    expect(item({
      state: "recoverable",
      lastError: { class: "insertion_failed" },
      text: { rawTranscript: null, cleanedText: "hello", formattedText: null },
    }).status).toBe("The text didn't land in the app. Copy it, or try inserting again.");
    expect(item({
      state: "recoverable",
      lastError: { class: "formatting_error" },
    }).status).toBe("Formatting didn't finish. Retry, use the raw text, or copy it.");
    expect(item({
      state: "recoverable",
      lastError: { class: "none" },
    }).status).toBe("Didn't finish. Retry, or copy the text.");
    expect(item({
      state: "captured",
      audio: { kind: "encrypted-session-file", path: "/tmp/a.enc" },
    }).status).toBe("Recording saved. Transcribe it to get the words back.");
    expect(item({
      state: "interrupted_recording",
      recoveryMode: "text-only",
      text: { rawTranscript: "hello", cleanedText: null, formattedText: null },
    }).status).toBe("Only the text was saved. The recording is gone.");
    expect(item({ state: "transcript_ready" }).status).toBe("Transcript ready. Format it, or use the raw text.");
    expect(item({ state: "text_ready" }).status).toBe("Ready to paste back.");
    expect(item({
      state: "captured",
      text: { rawTranscript: null, cleanedText: null, formattedText: null },
    }).preview).toBe("No transcript yet.");

    const expiredWithoutText = item({
      state: "captured",
      text: { rawTranscript: null, cleanedText: null, formattedText: null },
      retention: { ...base.retention, audioExpiresAt: "2026-06-16T11:00:00.000Z" },
    });
    expect(expiredWithoutText.status).toBe("The recording expired.");

    expect(item(base, new Date("2026-06-16T10:00:30.000Z")).age).toBe("Less than a minute ago");
    expect(item(base, new Date("2026-06-16T10:01:00.000Z")).age).toBe("1 minute ago");
    expect(item(base, new Date("2026-06-17T10:00:00.000Z")).age).toBe("1 day ago");
    expect(item(base, new Date("2026-06-19T10:00:00.000Z")).age).toBe("3 days ago");

    const blankExpiry = deriveRecoveryItem({
      ...toRecoveryEntryView(base),
      retention: { expiresAt: "not-a-date", audioExpiresAt: "also-not", expiredAt: null },
    }, now);
    expect(blankExpiry.expires).toBe("No expiry time was saved.");
    expect(item({
      retention: { ...base.retention, audioExpiresAt: "2026-06-16T11:00:00.000Z" },
    }).expires).toBe("Recording expired.");
    expect(item({
      retention: { ...base.retention, audioExpiresAt: "2026-06-16T12:30:00.000Z" },
    }).expires).toBe("Recording expires in 1 hour.");
    expect(item({
      retention: { ...base.retention, audioExpiresAt: "2026-06-18T18:00:00.000Z" },
    }).expires).toBe("Recording expires in 3 days.");

    const classes: RecoveryErrorClass[] = ["timeout", "no_speech", "microphone_permission_denied"];
    expect(classes.map((errorClass) => item({ state: "recoverable", lastError: { class: errorClass } }).status)).toEqual([
      "This took too long. Retry, or copy the text.",
      "No speech was detected. Record again, or discard this.",
      "Microphone access was denied. Allow it in System Settings, then retry.",
    ]);
  });

  it("locks concurrent actions on one recovery entry and reports false results", async () => {
    const busy = vi.fn();
    const error = vi.fn();
    const runner = createRecoveryActionRunner(busy, error);
    let finish: (value: boolean) => void = () => undefined;
    const action = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const first = runner.run("entry", action);
    await runner.run("entry", action);
    expect(action).toHaveBeenCalledTimes(1);
    expect(runner.isBusy("entry")).toBe(true);
    finish(false);
    await first;
    expect(error).toHaveBeenLastCalledWith("entry", expect.stringContaining("could not be completed"));
    expect(busy).toHaveBeenLastCalledWith("entry", false);
  });
});
