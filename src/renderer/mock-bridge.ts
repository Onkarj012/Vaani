// Browser-only stand-in for the Electron preload bridge, for previewing the renderer with fake data. Not shipped.
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { DictationEntry, Settings } from "@shared/types";
import type { RecoveryEntryView } from "@shared/recovery";

// ?dark or ?light in the URL picks the theme, so screenshots can be taken in both.
const themeParam = new URLSearchParams(location.search);
if (themeParam.has("dark")) localStorage.setItem("vaani-color-mode", "dark");
if (themeParam.has("light")) localStorage.setItem("vaani-color-mode", "light");

const day = 24 * 3600_000;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

// [app bundle, app name, raw transcript, cleaned text]
const samples: [string, string, string, string][] = [
  ["com.tinyspeck.slackmacgap", "Slack",
    "uh so deployed the web hook retry fix to staging um can someone from q a run the razor pay refund flow before four i'll push to prod after stand up tomorrow",
    "Deployed the webhook retry fix to staging. Can someone from QA run the Razorpay refund flow before 4? I'll push to prod after standup tomorrow."],
  ["com.microsoft.VSCode", "VS Code",
    "to do debounce the f n double press so hands free doesn't start on a single tap",
    "// TODO: debounce the fn double-press so hands-free doesn't start on a single tap."],
  ["com.apple.mail", "Mail",
    "hi priya thanks for sending the cap gemini training schedule i can join the angular module from monday third november",
    "Hi Priya, thanks for sending the Capgemini training schedule. I can join the Angular module from Monday, 3 November."],
  ["com.tinyspeck.slackmacgap", "Slack",
    "bhai can we move sunday cricket to six am scratch that can we move sunday cricket to seven am the baner turf is booked after eight",
    "Bhai, can we move Sunday cricket to 7 am? The Baner turf is booked after 8."],
  ["com.google.Chrome", "Chrome",
    "cold coffee places near baner open after ten p m",
    "Cold coffee places near Baner open after 10 pm"],
  ["com.apple.Notes", "Notes",
    "vaani two point oh you know pick haiku as the default formatter after the bake off and keep whisper c p p small as the offline fallback",
    "Vaani 2.0: pick Haiku as the default formatter after the bake-off and keep whisper.cpp small as the offline fallback."],
];

const history: DictationEntry[] = Array.from({ length: 30 }, (_, i) => {
  const [appBundleId, appName, rawText, cleanedText] = samples[i % samples.length]!;
  return {
    id: `e${i}`,
    traceId: null,
    timestamp: at(i * 2.6 * 3600_000 + 20 * 60_000),
    rawText,
    formattedText: cleanedText,
    cleanedText,
    durationSeconds: 4 + (i % 7) * 2.5,
    appBundleId,
    appName,
    injectionStatus: appName === "Chrome" ? "saved" : "injected",
    injectionMethod: "ax",
    language: "en",
  };
});

const recovery = [
  {
    id: "r1", state: "recoverable", createdAt: at(80 * 60_000), updatedAt: at(78 * 60_000), appName: "Slack",
    text: { rawTranscript: null, cleanedText: null, formattedText: null }, insertion: null,
    lastError: { class: "transcription_error", detail: "Groq returned 503 twice. Failover tried OpenAI, which hit its rate limit." },
    retention: { expiresAt: at(-6 * day), audioExpiresAt: at(-6 * day), expiredAt: null },
    recoveryMode: "full", terminal: null, audioAvailable: true, audioDurationSeconds: 14.2,
  },
  {
    id: "r2", state: "transcript_ready", createdAt: at(4 * 3600_000), updatedAt: at(4 * 3600_000), appName: "VS Code",
    text: { rawTranscript: "add a section on how recovery keeps audio encrypted for seven days", cleanedText: null, formattedText: null }, insertion: null,
    lastError: { class: "formatting_error", detail: "Cleanup did not answer within 8 s. The raw transcript is safe." },
    retention: { expiresAt: at(-6 * day), audioExpiresAt: at(-6 * day), expiredAt: null },
    recoveryMode: "full", terminal: null, audioAvailable: true, audioDurationSeconds: 7.9,
  },
] as unknown as RecoveryEntryView[];

let settings: Settings = {
  ...DEFAULT_SETTINGS,
  onboardingCompleted: true,
  openRouterKeyPromptShown: true,
  customCorrections: [
    { spoken: "razor pay", written: "Razorpay", source: "auto-suggested", enabled: true, hitCount: 41 },
    { spoken: "web hook", written: "webhook", source: "manual", enabled: true, hitCount: 28 },
    { spoken: "cap gemini", written: "Capgemini", source: "auto-suggested", enabled: true, hitCount: 12 },
    { spoken: "whisper c p p", written: "whisper.cpp", source: "manual", enabled: true, hitCount: 9 },
    { spoken: "grok", written: "Groq", source: "manual", enabled: false, hitCount: 2 },
  ],
  snippets: [
    { trigger: "sig", content: "Best,\nOnkar Jadhav" },
    { trigger: "email", content: "onkar@example.com" },
    { trigger: "standup", content: "Yesterday: …\nToday: …\nBlockers: none." },
  ],
} as Settings;

const noop = () => () => undefined;
const known: Record<string, (...args: never[]) => unknown> = {
  getDictationState: () => ({ status: "idle" }),
  getHistory: () => history,
  getSettings: () => settings,
  updateSettings: (patch: Partial<Settings>) => (settings = { ...settings, ...patch }),
  getPermissionStatus: () => ({ microphone: "granted", accessibility: "granted", inputMonitoring: "granted" }),
  checkPermissions: () => ({ microphone: "granted", accessibility: "granted", inputMonitoring: "granted" }),
  getRecoveryReadiness: () => ({ state: "ready", entryCount: recovery.length }),
  getRecoveryEntries: () => recovery,
  getRecoveryStorageUsage: () => ({ bytes: 12_400_000, sessions: 2 }),
  getRecoveryRestoredNotice: () => null,
  getUpdateStatus: () => null,
  getAppVersion: () => "2.0.0",
  listAudioInputDevices: () => [],
  whisperListModels: () => [],
  whisperIsModelLoaded: () => false,
};

// Any method not listed resolves to undefined; any on* subscription is a no-op.
window.vaani = new Proxy({} as Window["vaani"], {
  get: (_t, key: string) => {
    if (key.startsWith("on")) return noop;
    if (key.startsWith("report")) return () => undefined;
    return (...args: never[]) => Promise.resolve(known[key]?.(...args));
  },
});
