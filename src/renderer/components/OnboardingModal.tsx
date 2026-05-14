import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Keyboard,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  BookOpen,
  FileText,
  BarChart3,
  ChevronRight,
  ChevronLeft,
  X,
  ArrowRight,
  Zap,
  Volume2,
  Type,
  Wand2,
  History,
  Loader2,
  AlertCircle,
  Pencil,
  Eye,
  EyeOff,
  Plug,
} from "lucide-react";
import type { PermissionStatus, Settings } from "@shared/types";
import type { MacOSPermissionState } from "@shared/types";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import devanagariDarkUrl from "../../../assets/iconset/devanagari/devanagari_dark.svg?url";
import devanagariLightUrl from "../../../assets/iconset/devanagari/devanagari_light.svg?url";

interface OnboardingModalProps {
  settings: Settings;
  onComplete: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

const TOTAL_SLIDES = 7;

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
    scale: 0.97,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 60 : -60,
    opacity: 0,
    scale: 0.97,
  }),
};

export default function OnboardingModal({
  settings,
  onComplete,
  updateSettings,
}: OnboardingModalProps) {
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: "unknown",
    accessibility: "unknown",
  });
  const [busy, setBusy] = useState(false);
  const [micAttempted, setMicAttempted] = useState(false);
  const [apiKey, setApiKey] = useState(settings.groqApiKey ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  // Observe theme changes for child slides
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  async function refreshPermissions() {
    const next = await window.vaani.getPermissionStatus();
    setPermissions(next);
  }

  useEffect(() => {
    void refreshPermissions();
    const id = window.setInterval(() => {
      void refreshPermissions();
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  const goNext = useCallback(() => {
    if (slide < TOTAL_SLIDES - 1) {
      setDirection(1);
      setSlide((s) => s + 1);
    }
  }, [slide]);

  const goBack = useCallback(() => {
    if (slide > 0) {
      setDirection(-1);
      setSlide((s) => s - 1);
    }
  }, [slide]);

  async function requestMicrophone() {
    setBusy(true);
    setMicAttempted(true);
    try {
      const before = permissions.microphone;
      const microphone = await window.vaani.requestMicrophonePermission();
      setPermissions((current) => ({ ...current, microphone }));
      // If status didn't change and wasn't already granted, the system dialog
      // may not have appeared (common in unsigned dev builds on macOS).
      if (microphone === before && microphone !== "granted") {
        // eslint-disable-next-line no-console
        console.warn(
          "[onboarding] Microphone permission status did not change after request."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function requestAccessibility() {
    setBusy(true);
    try {
      const accessibility = await window.vaani.requestAccessibilityPermission();
      setPermissions((current) => ({ ...current, accessibility }));
      if (accessibility !== "granted") {
        await window.vaani.openPermissionSettings("accessibility");
      }
    } finally {
      setBusy(false);
    }
  }

  const micGranted = permissions.microphone === "granted";
  const accessibilityGranted = permissions.accessibility === "granted";
  const canContinueFromPermissions = micGranted && accessibilityGranted;

  const slidesContent = [
    <WelcomeSlide key="welcome" />,
    <HowItWorksSlide key="how" />,
    <PermissionsSlide
      key="perms"
      micGranted={micGranted}
      accessibilityGranted={accessibilityGranted}
      micState={permissions.microphone}
      busy={busy}
      micAttempted={micAttempted}
      onRequestMicrophone={() => {
        if (
          permissions.microphone === "denied" ||
          permissions.microphone === "restricted"
        ) {
          void window.vaani.openPermissionSettings("microphone");
        } else {
          void requestMicrophone();
        }
      }}
      onRequestAccessibility={() => {
        void requestAccessibility();
      }}
      onCheckAgain={() => {
        void refreshPermissions();
      }}
    />,
    <ProviderApiSlide
      key="api"
      settings={settings}
      apiKey={apiKey}
      showApiKey={showApiKey}
      onKeyChange={(v) => {
        setApiKey(v);
        void updateSettings({ groqApiKey: v });
        void updateSettings({ providerApiKeys: [{ providerId: settings.transcriptionProvider, key: v }] });
      }}
      onToggleShow={() => setShowApiKey(!showApiKey)}
      onProviderChange={(v) => updateSettings({ transcriptionProvider: v })}
    />,
    <HotkeySlide
      key="hotkey"
      primaryHotkey={settings.primaryHotkey}
      onChange={(v) => updateSettings({ primaryHotkey: v })}
    />,
    <FeaturesSlide key="features" />,
    <ReadySlide key="ready" onComplete={onComplete} />,
  ];

  const isLastSlide = slide === TOTAL_SLIDES - 1;
  const isFirstSlide = slide === 0;

  // Determine if next should be disabled
  const nextDisabled =
    (slide === 2 && !canContinueFromPermissions) ||
    (slide === 3 && !apiKey.trim()) ||
    busy;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-vaani-black/80 p-4 backdrop-blur-lg">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative w-full max-w-[640px] rounded-3xl border border-vaani-gray-200 bg-white shadow-2xl dark:border-vaani-gray-800 dark:bg-vaani-gray-900 overflow-hidden flex flex-col"
        style={{ height: 560 }}
      >
        {/* Skip button */}
        <button
          onClick={() => {
            void onComplete();
          }}
          className="absolute top-5 right-5 z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-vaani-gray-500 transition-colors hover:bg-vaani-gray-100 hover:text-vaani-gray-700 dark:text-vaani-gray-400 dark:hover:bg-vaani-gray-800 dark:hover:text-vaani-gray-200"
        >
          Skip
          <X size={14} />
        </button>

        {/* Slide counter */}
        <div className="absolute top-5 left-5 z-10 text-xs font-medium text-vaani-gray-400 dark:text-vaani-gray-500">
          {slide + 1} / {TOTAL_SLIDES}
        </div>

        {/* Slide content */}
        <div className="relative flex flex-1 flex-col items-center justify-center px-8 pt-14 pb-8 overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={slide}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className="w-full"
            >
              {slidesContent[slide]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom navigation */}
        <div className="border-t border-vaani-gray-100 px-8 py-5 dark:border-vaani-gray-800 shrink-0">
          <div className="flex items-center justify-between">
            {/* Back button */}
            <button
              onClick={goBack}
              disabled={isFirstSlide}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-vaani-gray-500 transition-all hover:bg-vaani-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-vaani-gray-400 dark:hover:bg-vaani-gray-800"
            >
              <ChevronLeft size={16} />
              Back
            </button>

            {/* Progress dots */}
            <div className="flex items-center gap-2">
              {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    // Only allow jumping to visited slides or next available
                    if (i <= slide + 1) {
                      setDirection(i > slide ? 1 : -1);
                      setSlide(i);
                    }
                  }}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === slide
                      ? "w-6 bg-vaani-pink"
                      : i < slide
                      ? "w-2 bg-vaani-pink/50"
                      : "w-2 bg-vaani-gray-200 dark:bg-vaani-gray-700"
                  }`}
                />
              ))}
            </div>

            {/* Next / Done button */}
            {isLastSlide ? (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  void onComplete();
                }}
                className="flex items-center gap-2 rounded-xl bg-vaani-pink px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-vaani-pink/25 transition-all hover:shadow-vaani-pink/40"
              >
                Start Dictating
                <Sparkles size={16} />
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={goNext}
                disabled={nextDisabled}
                className="flex items-center gap-2 rounded-xl bg-vaani-black px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90 dark:bg-white dark:text-vaani-black"
              >
                {slide === 2 || slide === 3 ? "Continue" : "Next"}
                <ChevronRight size={16} />
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Slide 1: Welcome ─────────────────────────────────────────────────────── */

function WelcomeSlide() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className="mb-6"
      >
        <img
          src={isDark ? devanagariDarkUrl : devanagariLightUrl}
          alt="Vaani"
          className="h-24 w-24"
        />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-3 text-3xl font-bold tracking-tight text-vaani-black dark:text-white"
      >
        Welcome to Vaani
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="max-w-sm text-base leading-relaxed text-vaani-gray-500 dark:text-vaani-gray-400"
      >
        Your voice, perfectly transcribed. Premium macOS dictation powered by
        AI.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-6 flex items-center gap-2 rounded-full bg-vaani-pink/10 px-4 py-2 text-sm font-medium text-vaani-pink dark:bg-vaani-pink/20"
      >
        <Zap size={14} />
        Setup takes under a minute
      </motion.div>
    </div>
  );
}

/* ─── Slide 2: How It Works ────────────────────────────────────────────────── */

function HowItWorksSlide() {
  const steps = [
    {
      icon: <Keyboard size={22} />,
      title: "Press your hotkey",
      desc: "Trigger dictation from anywhere on your Mac.",
      color: "bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20",
    },
    {
      icon: <Mic size={22} />,
      title: "Speak naturally",
      desc: "Talk at your normal pace. Vaani listens and understands.",
      color: "bg-vaani-lime/20 text-vaani-black dark:text-vaani-lime dark:bg-vaani-lime/20",
    },
    {
      icon: <Type size={22} />,
      title: "Text appears instantly",
      desc: "Transcribed text is inserted right where your cursor is.",
      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20"
      >
        <Wand2 size={26} />
      </motion.div>

      <h2 className="mb-2 text-2xl font-bold text-vaani-black dark:text-white">
        How it works
      </h2>
      <p className="mb-8 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
        Three simple steps. No clicking, no typing, just talk.
      </p>

      <div className="w-full space-y-3">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 * i }}
            className="flex items-center gap-4 rounded-2xl border border-vaani-gray-100 bg-vaani-gray-50/50 p-4 text-left dark:border-vaani-gray-800 dark:bg-vaani-gray-900/50"
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${step.color}`}
            >
              {step.icon}
            </div>
            <div>
              <div className="text-sm font-semibold text-vaani-black dark:text-white">
                {step.title}
              </div>
              <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
                {step.desc}
              </div>
            </div>
            <div className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-vaani-gray-200 text-xs font-bold text-vaani-gray-600 dark:bg-vaani-gray-700 dark:text-vaani-gray-300">
              {i + 1}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ─── Slide 3: Permissions ─────────────────────────────────────────────────── */

function PermissionsSlide({
  micGranted,
  accessibilityGranted,
  micState,
  busy,
  micAttempted,
  onRequestMicrophone,
  onRequestAccessibility,
  onCheckAgain,
}: {
  micGranted: boolean;
  accessibilityGranted: boolean;
  micState: MacOSPermissionState;
  busy: boolean;
  micAttempted: boolean;
  onRequestMicrophone: () => void;
  onRequestAccessibility: () => void;
  onCheckAgain: () => void;
}) {
  const allGranted = micGranted && accessibilityGranted;
  const showMicHint = micAttempted && !micGranted && micState !== "granted";

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-vaani-lime/20 text-vaani-black dark:text-vaani-lime dark:bg-vaani-lime/20"
      >
        <ShieldCheck size={26} />
      </motion.div>

      <h2 className="mb-2 text-2xl font-bold text-vaani-black dark:text-white">
        Grant Permissions
      </h2>
      <p className="mb-6 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
        Vaani needs two macOS permissions to transcribe and insert text.
      </p>

      <div className="w-full space-y-3">
        <PermissionRow
          icon={<Mic size={18} />}
          title="Microphone"
          description="Allows Vaani to record your voice when you press the hotkey."
          granted={micGranted}
          disabled={busy}
          actionLabel={micState === "denied" ? "Open Settings" : "Enable"}
          onAction={onRequestMicrophone}
        />
        <PermissionRow
          icon={<Keyboard size={18} />}
          title="Accessibility"
          description="Allows Vaani to insert dictated text into the active app."
          granted={accessibilityGranted}
          disabled={busy}
          actionLabel="Enable"
          onAction={onRequestAccessibility}
        />
      </div>

      {showMicHint && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left dark:border-amber-900/40 dark:bg-amber-900/20"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            If the system dialog did not appear, you may need to grant microphone access manually in{" "}
            <span className="font-semibold">System Settings → Privacy & Security → Microphone</span>.
          </p>
        </motion.div>
      )}

      {!allGranted && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onCheckAgain}
          className="mt-4 flex items-center gap-2 text-xs font-medium text-vaani-gray-500 transition-colors hover:text-vaani-gray-700 dark:text-vaani-gray-400 dark:hover:text-vaani-gray-200"
        >
          <ArrowRight size={12} className="rotate-[-45deg]" />
          Check again
        </motion.button>
      )}

      {allGranted && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-5 flex items-center gap-2 rounded-full bg-vaani-lime/15 px-4 py-2 text-sm font-semibold text-vaani-black dark:text-vaani-lime"
        >
          <CheckCircle2 size={16} />
          All permissions granted
        </motion.div>
      )}
    </div>
  );
}

/* ─── Slide 4: Provider + API Key ───────────────────────────────────────────── */

function ProviderApiSlide({
  settings,
  apiKey,
  showApiKey,
  onKeyChange,
  onToggleShow,
  onProviderChange,
}: {
  settings: Settings;
  apiKey: string;
  showApiKey: boolean;
  onKeyChange: (v: string) => void;
  onToggleShow: () => void;
  onProviderChange: (v: string) => void;
}) {
  const isValid = apiKey.trim().length > 0;
  const sttProviders = KNOWN_PROVIDERS.filter(p => p.type === 'stt' || p.type === 'local-stt');
  const activeProvider = sttProviders.find(p => p.id === settings.transcriptionProvider);
  const [provOpen, setProvOpen] = useState(false);

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20"
      >
        <Plug size={26} />
      </motion.div>

      <h2 className="mb-2 text-2xl font-bold text-vaani-black dark:text-white">
        Choose Provider &amp; Add Key
      </h2>
      <p className="mb-6 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
        Your key stays on your device. Start with Groq — it's fast and free.
      </p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="w-full space-y-3"
      >
        {/* Provider selector */}
        <div>
          <label className="block text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 mb-1 text-left">
            Transcription Provider
          </label>
          <div className="relative">
            <button
              onClick={() => setProvOpen(!provOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm text-vaani-black dark:text-white hover:border-vaani-gray-300 transition-colors"
            >
              {activeProvider?.name ?? 'Select provider'}
              <ChevronRight size={14} className={`text-vaani-gray-400 transition-transform ${provOpen ? 'rotate-90' : ''}`} />
            </button>
            {provOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProvOpen(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                  {sttProviders.map((p) => (
                    <button key={p.id}
                      onClick={() => { onProviderChange(p.id); setProvOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-vaani-gray-50 dark:hover:bg-vaani-gray-700 transition-colors flex items-center justify-between ${
                        settings.transcriptionProvider === p.id ? 'text-vaani-pink font-medium' : 'text-vaani-black dark:text-white'
                      }`}
                    >
                      {p.name}
                      {settings.transcriptionProvider === p.id && <CheckCircle2 size={14} className="text-vaani-pink" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* API key input */}
        {activeProvider?.requiresApiKey !== false && (
          <div>
            <label className="block text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 mb-1 text-left">
              {activeProvider?.name ?? 'Provider'} API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onKeyChange(e.target.value)}
                placeholder={activeProvider?.id === 'openai' ? 'sk-...' : activeProvider?.id === 'deepgram' ? 'Token...' : 'gsk_...'}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-vaani-gray-200 bg-vaani-gray-50 px-4 py-3 pr-11 text-sm text-vaani-black outline-none transition-all focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 dark:border-vaani-gray-700 dark:bg-vaani-gray-800 dark:text-white placeholder:text-vaani-gray-400"
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-vaani-gray-400 hover:text-vaani-gray-600 dark:hover:text-vaani-gray-200 transition-colors"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {isValid && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-xl bg-vaani-lime/10 px-3 py-2 text-xs font-medium text-vaani-black dark:text-vaani-lime"
          >
            <CheckCircle2 size={13} />
            API key saved — you're ready to dictate
          </motion.div>
        )}

        <div className="rounded-xl border border-vaani-gray-100 bg-vaani-gray-50/50 p-4 text-left dark:border-vaani-gray-800 dark:bg-vaani-gray-900/50">
          <p className="mb-2 text-xs font-semibold text-vaani-gray-600 dark:text-vaani-gray-300">
            How to get a Groq key (free)
          </p>
          <ol className="space-y-1 text-xs text-vaani-gray-500 dark:text-vaani-gray-400 list-decimal list-inside">
            <li>Go to <span className="font-medium text-vaani-gray-700 dark:text-vaani-gray-200">console.groq.com</span></li>
            <li>Sign up or log in</li>
            <li>Navigate to <span className="font-medium text-vaani-gray-700 dark:text-vaani-gray-200">API Keys</span> and create one</li>
            <li>Paste it above</li>
          </ol>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Slide 5: Hotkey Setup ────────────────────────────────────────────────── */

const HOTKEY_MOD_SYMBOL: Record<string, string> = {
  Cmd: "⌘", Ctrl: "⌃", Option: "⌥", Shift: "⇧",
};
const HOTKEY_MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
const HOTKEY_MODIFIER_LABEL: Record<string, string> = {
  Meta: "Cmd", Control: "Ctrl", Alt: "Option", Shift: "Shift",
};

function HotkeySlide({
  primaryHotkey,
  onChange,
}: {
  primaryHotkey: string;
  onChange: (v: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);

  const stopEditing = useCallback(() => {
    void window.vaani.setHotkeyCapture(false);
    setIsEditing(false);
    setPreview([]);
  }, []);

  const startEditing = useCallback(() => {
    void window.vaani.setHotkeyCapture(true);
    setPreview([]);
    setIsEditing(true);
  }, []);

  useEffect(() => {
    if (!isEditing) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stopEditing(); return; }

      const mods: string[] = [];
      if (e.metaKey) mods.push("Cmd");
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Option");
      if (e.shiftKey) mods.push("Shift");

      if (HOTKEY_MODIFIER_KEYS.has(e.key)) {
        setPreview([HOTKEY_MODIFIER_LABEL[e.key] ?? e.key]);
        return;
      }

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const parts = [...mods, key];
      onChange(parts.join("+"));
      stopEditing();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stopEditing);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", stopEditing);
    };
  }, [isEditing, onChange, stopEditing]);

  useEffect(() => () => { void window.vaani.setHotkeyCapture(false); }, []);

  const displayKeys = primaryHotkey.split("+").filter(Boolean);

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20"
      >
        <Keyboard size={26} />
      </motion.div>

      <h2 className="mb-2 text-2xl font-bold text-vaani-black dark:text-white">
        Your Shortcut
      </h2>
      <p className="mb-8 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
        Choose the key combination you will press to start dictating.
      </p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="w-full rounded-2xl border border-vaani-gray-100 bg-vaani-gray-50/50 p-5 dark:border-vaani-gray-800 dark:bg-vaani-gray-900/50"
      >
        {!isEditing ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              {displayKeys.map((k, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="inline-flex items-center justify-center rounded-lg border-2 border-vaani-gray-300 bg-vaani-gray-100 px-2.5 py-1.5 text-sm font-bold text-vaani-black dark:border-vaani-gray-600 dark:bg-vaani-gray-800 dark:text-white min-w-[36px]">
                    {HOTKEY_MOD_SYMBOL[k] ?? k}
                  </span>
                  {i < displayKeys.length - 1 && (
                    <span className="text-xs text-vaani-gray-400 dark:text-vaani-gray-500">+</span>
                  )}
                </span>
              ))}
            </div>
            <button
              onClick={startEditing}
              className="flex items-center gap-1.5 rounded-xl bg-vaani-gray-100 px-3 py-2 text-sm font-medium text-vaani-gray-600 transition-colors hover:bg-vaani-gray-200 dark:bg-vaani-gray-800 dark:text-vaani-gray-300 dark:hover:bg-vaani-gray-700"
            >
              <Pencil size={14} />
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-vaani-pink">
                Press your new shortcut…
              </p>
              <button
                onClick={stopEditing}
                className="text-xs text-vaani-gray-400 hover:text-vaani-gray-600 dark:hover:text-vaani-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            <div className="flex min-h-[40px] items-center gap-1.5">
              {preview.length > 0 ? (
                preview.map((k, i) => (
                  <span key={i} className="inline-flex items-center justify-center rounded-lg border-2 border-vaani-pink bg-vaani-pink/10 px-2.5 py-1.5 text-sm font-bold text-vaani-pink min-w-[36px]">
                    {HOTKEY_MOD_SYMBOL[k] ?? k}
                  </span>
                ))
              ) : (
                <span className="text-xs text-vaani-gray-400 dark:text-vaani-gray-500">
                  Hold modifiers (⌃⌥⇧⌘) then press a key
                </span>
              )}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-vaani-gray-400 dark:text-vaani-gray-500 text-left">
          <Volume2 size={10} className="inline mr-1" />
          You can also change this anytime in Settings
        </p>
      </motion.div>
    </div>
  );
}

/* ─── Slide 6: Features ────────────────────────────────────────────────────── */

function FeaturesSlide() {
  const features = [
    {
      icon: <Sparkles size={18} />,
      title: "Smart Cleanup",
      desc: "Removes filler words and adds punctuation automatically.",
      color: "bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20",
    },
    {
      icon: <BookOpen size={18} />,
      title: "Custom Dictionary",
      desc: "Teach Vaani names, brands, and words you use often.",
      color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    },
    {
      icon: <FileText size={18} />,
      title: "Snippets",
      desc: "Type shortcuts like /address to expand full text blocks.",
      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    },
    {
      icon: <BarChart3 size={18} />,
      title: "History & Insights",
      desc: "Track your dictation habits, word counts, and streaks.",
      color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
  ];

  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-vaani-lime/20 text-vaani-black dark:text-vaani-lime dark:bg-vaani-lime/20"
      >
        <Sparkles size={26} />
      </motion.div>

      <h2 className="mb-2 text-2xl font-bold text-vaani-black dark:text-white">
        Power Features
      </h2>
      <p className="mb-8 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
        Explore these anytime from the sidebar.
      </p>

      <div className="grid w-full grid-cols-2 gap-3">
        {features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i }}
            className="flex flex-col items-start rounded-2xl border border-vaani-gray-100 bg-vaani-gray-50/50 p-4 text-left dark:border-vaani-gray-800 dark:bg-vaani-gray-900/50"
          >
            <div
              className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${f.color}`}
            >
              {f.icon}
            </div>
            <div className="text-sm font-semibold text-vaani-black dark:text-white">
              {f.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-vaani-gray-500 dark:text-vaani-gray-400">
              {f.desc}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ─── Slide 7: Ready ───────────────────────────────────────────────────────── */

function ReadySlide({ onComplete: _onComplete }: { onComplete: () => Promise<void> }) {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-vaani-lime/20 text-vaani-black dark:text-vaani-lime dark:bg-vaani-lime/20"
      >
        <CheckCircle2 size={36} />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-2 text-2xl font-bold text-vaani-black dark:text-white"
      >
        You are all set!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="max-w-xs text-sm leading-relaxed text-vaani-gray-500 dark:text-vaani-gray-400"
      >
        Press your hotkey anytime to start dictating. Vaani is ready when you
        are.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mt-8 flex items-center gap-3 rounded-2xl border border-vaani-gray-100 bg-vaani-gray-50/50 px-5 py-4 dark:border-vaani-gray-800 dark:bg-vaani-gray-900/50"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-vaani-pink/10 text-vaani-pink dark:bg-vaani-pink/20">
          <History size={18} />
        </div>
        <div className="text-left">
          <div className="text-sm font-medium text-vaani-black dark:text-white">
            Reopen this guide
          </div>
          <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
            Settings → Reset Onboarding
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Permission Row (reused) ──────────────────────────────────────────────── */

function PermissionRow({
  icon,
  title,
  description,
  granted,
  disabled,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  granted: boolean;
  disabled: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-vaani-gray-100 bg-white p-4 dark:border-vaani-gray-800 dark:bg-vaani-gray-900/30">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-vaani-gray-100 text-vaani-gray-600 dark:bg-vaani-gray-800 dark:text-vaani-gray-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold text-vaani-black dark:text-white">
          {title}
        </div>
        <p className="text-xs leading-snug text-vaani-gray-500 dark:text-vaani-gray-400">
          {description}
        </p>
      </div>
      {granted ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-vaani-lime/15 px-3 py-2 text-sm font-semibold text-vaani-black dark:text-vaani-lime">
          <CheckCircle2 size={15} />
          Enabled
        </div>
      ) : (
        <button
          onClick={onAction}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-vaani-pink px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {disabled && <Loader2 size={14} className="animate-spin" />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}
