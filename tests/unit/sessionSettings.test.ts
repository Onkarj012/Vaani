import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import {
  SESSION_SETTINGS_SCHEMA_VERSION,
  captureSessionSettings,
  parseSessionSettings,
  restoreSessionSettings,
} from "@shared/sessionSettings";
import type { Settings } from "@shared/types";

const EXPECTED_KEYS = [
  "schemaVersion", "language", "transcriptionProvider", "transcriptionModel", "formattingProvider", "formattingModel",
  "customPrompt", "offlineMode", "failoverEnabled", "localWhisperModel", "customCorrections", "snippets", "appProfiles",
  "stylePreset", "contextAwarenessEnabled", "cleanupEnabled", "smartPunctuation", "fillerWords", "fillerWordsCustomized",
  "extraFillerWords", "injectionMode", "silenceThreshold", "minClipDuration", "saveRecordings", "recordingsPath",
  "retainFailedAudio", "recoveryRetentionDays",
].sort();

function settingsFixture(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    groqApiKey: "gsk-canary-secret",
    providerApiKeys: [{ providerId: "openai", key: "sk-canary-secret", hasKey: true }],
    primaryHotkey: "Cmd+Shift+Space",
    language: "en",
    transcriptionProvider: "groq",
    transcriptionModel: "whisper-large-v3-turbo",
    formattingProvider: "groq",
    formattingModel: "llama-3.3-70b",
    customPrompt: "Keep it terse.",
    offlineMode: "always-online",
    failoverEnabled: true,
    fillerWords: ["um", "uh"],
    fillerWordsCustomized: true,
    extraFillerWords: ["like"],
    customCorrections: [{ spoken: "vani", written: "Vaani", source: "manual", wholeWord: true, hitCount: 2 }],
    snippets: [{ trigger: "sig", content: "Regards", matchBareTrigger: true, appProfileIds: ["mail"] }],
    appProfiles: [{ id: "mail", name: "Mail", appBundleIds: ["com.apple.mail"], stylePreset: "email", autoSubmit: false }],
    stylePreset: "developer",
    injectionMode: "clipboard",
    silenceThreshold: 0.02,
    minClipDuration: 400,
    saveRecordings: true,
    recordingsPath: "/tmp/vaani-recordings",
    retainFailedAudio: true,
    recoveryRetentionDays: 7,
  };
}

describe("session settings snapshot", () => {
  it("captures only the allowlisted non-secret fields", () => {
    const snapshot = captureSessionSettings(settingsFixture());
    expect(snapshot.schemaVersion).toBe(SESSION_SETTINGS_SCHEMA_VERSION);
    expect(Object.keys(snapshot).sort()).toEqual(EXPECTED_KEYS);
    expect(JSON.stringify(snapshot)).not.toContain("canary");
    expect(snapshot.injectionMode).toBe("clipboard");
    expect(snapshot.appProfiles[0]?.appBundleIds).toEqual(["com.apple.mail"]);
  });

  it("deep copies arrays and nested objects on capture and restore", () => {
    const settings = settingsFixture();
    const snapshot = captureSessionSettings(settings);
    settings.customCorrections[0]!.written = "mutated";
    settings.snippets[0]!.appProfileIds!.push("mutated");
    settings.appProfiles![0]!.appBundleIds.push("mutated");
    settings.fillerWords.push("mutated");
    expect(snapshot.customCorrections[0]?.written).toBe("Vaani");
    expect(snapshot.snippets[0]?.appProfileIds).toEqual(["mail"]);
    expect(snapshot.appProfiles[0]?.appBundleIds).toEqual(["com.apple.mail"]);
    expect(snapshot.fillerWords).toEqual(["um", "uh"]);

    const restored = restoreSessionSettings(snapshot);
    restored.snippets[0]!.appProfileIds!.push("after-restore");
    restored.extraFillerWords.push("after-restore");
    expect(snapshot.snippets[0]?.appProfileIds).toEqual(["mail"]);
    expect(snapshot.extraFillerWords).toEqual(["like"]);
  });

  it("restores over defaults without credentials", () => {
    const restored = restoreSessionSettings(captureSessionSettings(settingsFixture()));
    expect(restored.groqApiKey).toBe("");
    expect(restored.providerApiKeys).toEqual([]);
    expect(restored.primaryHotkey).toBe(DEFAULT_SETTINGS.primaryHotkey);
    expect(restored.formattingModel).toBe("llama-3.3-70b");
    expect(restored.recoveryRetentionDays).toBe(7);
    expect(JSON.stringify(restored)).not.toContain("canary");
  });

  it("round-trips through JSON and parse", () => {
    const snapshot = captureSessionSettings(settingsFixture());
    const parsed = parseSessionSettings(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed).toEqual(snapshot);
    expect(parseSessionSettings(captureSessionSettings(DEFAULT_SETTINGS))).toEqual(captureSessionSettings(DEFAULT_SETTINGS));
  });

  it("strips unknown fields, including nested key canaries", () => {
    const snapshot = captureSessionSettings(settingsFixture());
    const tampered = {
      ...snapshot,
      groqApiKey: "canary",
      providerApiKeys: [{ providerId: "x", key: "canary" }],
      customCorrections: [{ ...snapshot.customCorrections[0], apiKey: "canary" }],
      snippets: [{ ...snapshot.snippets[0], key: "canary" }],
      appProfiles: [{ ...snapshot.appProfiles[0], providerApiKeys: [{ key: "canary" }] }],
    };
    const parsed = parseSessionSettings(tampered);
    expect(parsed).toEqual(snapshot);
    expect(JSON.stringify(parsed)).not.toContain("canary");
  });

  const valid = (): Record<string, unknown> => JSON.parse(JSON.stringify(captureSessionSettings(settingsFixture())));
  it.each<[string, unknown]>([
    ["null", null],
    ["array", []],
    ["string", "snapshot"],
    ["unknown schema version", { ...valid(), schemaVersion: 2 }],
    ["missing schema version", { ...valid(), schemaVersion: undefined }],
    ["missing required field", { ...valid(), language: undefined }],
    ["bad injection mode", { ...valid(), injectionMode: "paste" }],
    ["bad offline mode", { ...valid(), offlineMode: "sometimes" }],
    ["bad retention days", { ...valid(), recoveryRetentionDays: 5 }],
    ["non-finite threshold", { ...valid(), silenceThreshold: Number.NaN }],
    ["bad filler word", { ...valid(), fillerWords: ["um", 2] }],
    ["bad correction", { ...valid(), customCorrections: [{ spoken: 1, written: "x" }] }],
    ["bad correction source", { ...valid(), customCorrections: [{ spoken: "a", written: "b", source: "robot" }] }],
    ["snippets not array", { ...valid(), snippets: {} }],
    ["bad snippet profile ids", { ...valid(), snippets: [{ trigger: "t", content: "c", appProfileIds: [1] }] }],
    ["bad app profile", { ...valid(), appProfiles: [{ id: "a", name: "b", appBundleIds: "com.x" }] }],
    ["bad app profile style", { ...valid(), appProfiles: [{ id: "a", name: "b", appBundleIds: [], stylePreset: "loud" }] }],
  ])("rejects %s", (_label, value) => {
    expect(parseSessionSettings(value)).toBeNull();
  });
});
