import { useCallback, useEffect, useRef, useState } from "react";
import { blobToClip } from "@renderer/hooks/useAudioRecorder";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Keyboard, ShieldCheck, CheckCircle2, Sparkles, BookOpen, FileText,
  BarChart3, ChevronRight, ChevronLeft, X, ArrowRight, Zap, Volume2, Type,
  Wand2, History, Loader2, AlertCircle, Pencil, Eye, EyeOff, Plug,
} from "lucide-react";
import type { DictationMode, PermissionStatus, Settings, MacOSPermissionState } from "@shared/types";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import devanagariLightUrl from "../../../assets/iconset/devanagari/devanagari_light.svg?url";
import devanagariDarkUrl from "../../../assets/iconset/devanagari/devanagari_dark.svg?url";
import { useColorMode } from "../context/color-mode";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const EXCLUDED_LLM_KEY_PROVIDERS = new Set(["openai-llm", "openrouter", "groq-llm"]);
const TOTAL_SLIDES = 8;

interface OnboardingModalProps {
  settings: Settings;
  onComplete: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
}

const slideVariants = {
  enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0, scale: 0.97 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (d: number) => ({ x: d < 0 ? 60 : -60, opacity: 0, scale: 0.97 }),
};

export default function OnboardingModal({ settings, onComplete, updateSettings }: OnboardingModalProps) {
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [permissions, setPermissions] = useState<PermissionStatus>({ microphone: "unknown", accessibility: "unknown" });
  const [busy, setBusy] = useState(false);
  const [micAttempted, setMicAttempted] = useState(false);
  const [apiKey, setApiKey] = useState(() => {
    const entry = (settings.providerApiKeys ?? []).find((k) => k.providerId === settings.transcriptionProvider);
    return entry?.key ?? (settings.transcriptionProvider === "groq" ? settings.groqApiKey ?? "" : "");
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState(() => {
    const entry = (settings.providerApiKeys ?? []).find((k) => k.providerId === settings.formattingProvider);
    return entry?.key ?? "";
  });
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);

  function upsertProviderKey(providerId: string, key: string) {
    const current = settings.providerApiKeys ?? [];
    const idx = current.findIndex((k) => k.providerId === providerId);
    return idx >= 0 ? current.map((k, i) => (i === idx ? { providerId, key } : k)) : [...current, { providerId, key }];
  }

  async function refreshPermissions() {
    setPermissions(await window.vaani.getPermissionStatus());
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    void refreshPermissions();
    const id = window.setInterval(() => { void refreshPermissions(); }, 1500);
    return () => window.clearInterval(id);
  }, []);

  const goNext = useCallback(() => {
    if (slide < TOTAL_SLIDES - 1) { setDirection(1); setSlide((s) => s + 1); }
  }, [slide]);
  const goBack = useCallback(() => {
    if (slide > 0) { setDirection(-1); setSlide((s) => s - 1); }
  }, [slide]);

  async function requestMicrophone() {
    setBusy(true); setMicAttempted(true);
    try {
      const microphone = await window.vaani.requestMicrophonePermission();
      setPermissions((c) => ({ ...c, microphone }));
    } finally { setBusy(false); }
  }

  async function requestAccessibility() {
    setBusy(true);
    try {
      const accessibility = await window.vaani.requestAccessibilityPermission();
      setPermissions((c) => ({ ...c, accessibility }));
      if (accessibility !== "granted") await window.vaani.openPermissionSettings("accessibility");
    } finally { setBusy(false); }
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
        if (permissions.microphone === "denied" || permissions.microphone === "restricted") void window.vaani.openPermissionSettings("microphone");
        else void requestMicrophone();
      }}
      onRequestAccessibility={() => { void requestAccessibility(); }}
      onCheckAgain={() => { void refreshPermissions(); }}
    />,
    <ProviderApiSlide
      key="api"
      settings={settings}
      apiKey={apiKey}
      showApiKey={showApiKey}
      llmApiKey={llmApiKey}
      showLlmApiKey={showLlmApiKey}
      onKeyChange={(v) => {
        setApiKey(v);
        void updateSettings({ providerApiKeys: upsertProviderKey(settings.transcriptionProvider, v), ...(settings.transcriptionProvider === "groq" ? { groqApiKey: v } : {}) });
      }}
      onToggleShow={() => setShowApiKey(!showApiKey)}
      onProviderChange={(v) => {
        void updateSettings({ transcriptionProvider: v });
        const entry = (settings.providerApiKeys ?? []).find((k) => k.providerId === v);
        setApiKey(entry?.key ?? (v === "groq" ? settings.groqApiKey ?? "" : ""));
      }}
      onLlmKeyChange={(v) => {
        setLlmApiKey(v);
        void updateSettings({ providerApiKeys: upsertProviderKey(settings.formattingProvider, v) });
      }}
      onToggleLlmShow={() => setShowLlmApiKey(!showLlmApiKey)}
      onLlmProviderChange={(v) => {
        void updateSettings({ formattingProvider: v });
        const entry = (settings.providerApiKeys ?? []).find((k) => k.providerId === v);
        setLlmApiKey(entry?.key ?? "");
      }}
    />,
    <HotkeySlide key="hotkey" primaryHotkey={settings.primaryHotkey} onChange={(v) => updateSettings({ primaryHotkey: v })} />,
    <FeaturesSlide key="features" />,
    <DemoSlide key="demo" primaryHotkey={settings.primaryHotkey} dictationMode={settings.dictationMode} />,
    <ReadySlide key="ready" />,
  ];

  const isLastSlide = slide === TOTAL_SLIDES - 1;
  const isFirstSlide = slide === 0;

  const selectedSttProvider = KNOWN_PROVIDERS.find((p) => p.id === settings.transcriptionProvider && (p.type === "stt" || p.type === "local-stt"));
  const requiresApiKey = selectedSttProvider?.requiresApiKey !== false;
  const hasRequiredSttKey = !requiresApiKey || !!apiKey.trim();
  const selectedLlmProvider = KNOWN_PROVIDERS.find((p) => p.id === settings.formattingProvider && p.type === "llm");
  const llmRequiresKey = selectedLlmProvider?.requiresApiKey !== false;
  const llmNeedsOnboardingKey = llmRequiresKey && !EXCLUDED_LLM_KEY_PROVIDERS.has(selectedLlmProvider?.id ?? "");
  const hasRequiredLlmKey = !llmNeedsOnboardingKey || !!llmApiKey.trim();
  const hasRequiredApiKey = hasRequiredSttKey && hasRequiredLlmKey;

  const nextDisabled = (slide === 2 && !canContinueFromPermissions) || (slide === 3 && !hasRequiredApiKey) || busy;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overscroll-none bg-black/50 p-4 backdrop-blur-md" onWheel={(e) => e.preventDefault()}>
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative flex h-[min(90vh,780px)] w-full max-w-[760px] flex-col overflow-hidden rounded-[20px] bg-bg shadow-card"
      >
        <button onClick={() => { void onComplete(); }} className="absolute right-5 top-5 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink">
          Skip <X size={14} />
        </button>
        <div className="label-meta absolute left-5 top-5 z-10 text-[10px] text-faint">{slide + 1} / {TOTAL_SLIDES}</div>

        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-8 pb-6 pt-14">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div key={slide} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ type: "spring", stiffness: 400, damping: 32 }} className="w-full">
              {slidesContent[slide]}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="shrink-0 border-t border-line px-8 py-5">
          <div className="flex items-center justify-between">
            <button onClick={goBack} disabled={isFirstSlide} className="flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-muted transition-all hover:bg-surface disabled:cursor-not-allowed disabled:opacity-30">
              <ChevronLeft size={16} /> Back
            </button>

            <div className="flex items-center gap-2">
              {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  onClick={() => { if (i <= slide + 1) { setDirection(i > slide ? 1 : -1); setSlide(i); } }}
                  className={`h-2 rounded-full transition-all duration-300 ${i === slide ? "w-6 bg-accent" : i < slide ? "w-2 bg-accent/40" : "w-2 bg-line"}`}
                />
              ))}
            </div>

            {isLastSlide ? (
              <Button variant="accent" size="sm" onClick={() => { void onComplete(); }}>Start Dictating <Sparkles size={16} /></Button>
            ) : (
              <Button size="sm" onClick={goNext} disabled={nextDisabled}>{slide === 2 || slide === 3 ? "Continue" : "Next"} <ChevronRight size={16} /></Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Slides ─────────────────────────────────────────────────────────────── */

function SlideIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <div className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl ${tone}`}>{children}</div>;
}

function WelcomeSlide() {
  const { mode } = useColorMode()
  return (
    <div className="flex flex-col items-center text-center">
      <motion.img initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        src={mode === "dark" ? devanagariDarkUrl : devanagariLightUrl} alt="Vaani" className="mb-6 h-24 w-24" />
      <h1 className="text-display mb-3 text-4xl text-ink">Welcome to Vaani</h1>
      <p className="max-w-sm leading-relaxed text-muted">Your voice, perfectly transcribed. Premium macOS dictation powered by AI.</p>
      <div className="mt-6 flex items-center gap-2 rounded-full bg-accent/10 px-4 py-2 text-sm font-medium text-accent">
        <Zap size={14} /> Setup takes under a minute
      </div>
    </div>
  );
}

function HowItWorksSlide() {
  const steps = [
    { icon: <Keyboard size={20} />, title: "Press your hotkey", desc: "Trigger dictation from anywhere on your Mac.", tone: "bg-accent/10 text-accent" },
    { icon: <Mic size={20} />, title: "Speak naturally", desc: "Talk at your normal pace. Vaani listens and understands.", tone: "bg-accent/10 text-accent" },
    { icon: <Type size={20} />, title: "Text appears instantly", desc: "Transcribed text is inserted right where your cursor is.", tone: "bg-accent/10 text-accent" },
  ];
  return (
    <div className="flex flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><Wand2 size={26} /></SlideIcon>
      <h2 className="text-display mb-2 text-3xl text-ink">How it works</h2>
      <p className="mb-8 text-sm text-muted">Three simple steps. No clicking, no typing, just talk.</p>
      <div className="w-full space-y-3">
        {steps.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * i }}
            className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.tone}`}>{s.icon}</div>
            <div>
              <div className="text-sm font-semibold text-ink">{s.title}</div>
              <div className="text-xs text-muted">{s.desc}</div>
            </div>
            <div className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg font-mono text-xs font-bold text-muted">{i + 1}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function PermissionsSlide({
  micGranted, accessibilityGranted, micState, busy, micAttempted,
  onRequestMicrophone, onRequestAccessibility, onCheckAgain,
}: {
  micGranted: boolean; accessibilityGranted: boolean; micState: MacOSPermissionState;
  busy: boolean; micAttempted: boolean;
  onRequestMicrophone: () => void; onRequestAccessibility: () => void; onCheckAgain: () => void;
}) {
  const allGranted = micGranted && accessibilityGranted;
  const showMicHint = micAttempted && !micGranted && micState !== "granted";
  return (
    <div className="flex flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><ShieldCheck size={26} /></SlideIcon>
      <h2 className="text-display mb-2 text-3xl text-ink">Grant Permissions</h2>
      <p className="mb-6 text-sm text-muted">Vaani needs two macOS permissions to transcribe and insert text.</p>
      <div className="w-full space-y-3">
        <PermissionRow icon={<Mic size={18} />} title="Microphone" description="Allows Vaani to record your voice when you press the hotkey." granted={micGranted} disabled={busy} actionLabel={micState === "denied" ? "Open Settings" : "Enable"} onAction={onRequestMicrophone} />
        <PermissionRow icon={<Keyboard size={18} />} title="Accessibility" description="Allows Vaani to insert dictated text into the active app." granted={accessibilityGranted} disabled={busy} actionLabel="Enable" onAction={onRequestAccessibility} />
      </div>
      {showMicHint && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-left">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-accent">If the system dialog did not appear, grant microphone access manually in <span className="font-semibold">System Settings → Privacy &amp; Security → Microphone</span>.</p>
        </motion.div>
      )}
      {!allGranted && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <button onClick={onCheckAgain} className="flex items-center gap-2 text-xs font-medium text-muted transition-colors hover:text-ink">
            <ArrowRight size={12} className="rotate-[-45deg]" /> Check again
          </button>
          {!accessibilityGranted && (
            <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-center">
              <p className="text-xs leading-relaxed text-muted">
                Already enabled Accessibility but it still shows here? macOS sometimes only detects it after a restart.
              </p>
              <Button variant="soft" size="sm" onClick={() => { void window.vaani.relaunchApp() }}>Restart Vaani</Button>
            </div>
          )}
        </div>
      )}
      {allGranted && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-5 flex items-center gap-2 rounded-full bg-accent/10 px-4 py-2 text-sm font-semibold text-accent">
          <CheckCircle2 size={16} /> All permissions granted
        </motion.div>
      )}
    </div>
  );
}

function ProviderApiSlide({
  settings, apiKey, showApiKey, llmApiKey, showLlmApiKey,
  onKeyChange, onToggleShow, onProviderChange, onLlmKeyChange, onToggleLlmShow, onLlmProviderChange,
}: {
  settings: Settings; apiKey: string; showApiKey: boolean; llmApiKey: string; showLlmApiKey: boolean;
  onKeyChange: (v: string) => void; onToggleShow: () => void; onProviderChange: (v: string) => void;
  onLlmKeyChange: (v: string) => void; onToggleLlmShow: () => void; onLlmProviderChange: (v: string) => void;
}) {
  const isValid = apiKey.trim().length > 0;
  const sttProviders = KNOWN_PROVIDERS.filter((p) => p.type === "stt" || p.type === "local-stt");
  const activeProvider = sttProviders.find((p) => p.id === settings.transcriptionProvider);
  const llmProviders = KNOWN_PROVIDERS.filter((p) => p.type === "llm");
  const activeLlm = llmProviders.find((p) => p.id === settings.formattingProvider);
  const showLlmKeyInput = activeLlm?.requiresApiKey !== false && !EXCLUDED_LLM_KEY_PROVIDERS.has(activeLlm?.id ?? "");

  return (
    <div className="flex flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><Plug size={24} /></SlideIcon>
      <h2 className="text-display mb-1 text-3xl text-ink">Choose Providers &amp; Add Keys</h2>
      <p className="mb-5 text-sm text-muted">Your keys stay on your device. Start with Groq — it&apos;s fast and free.</p>

      <div className="w-full space-y-3 text-left">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Transcription Provider</label>
          <Select value={settings.transcriptionProvider} onChange={onProviderChange} options={sttProviders.map((p) => ({ value: p.id, label: p.name }))} />
        </div>

        {activeProvider?.requiresApiKey !== false && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">{activeProvider?.name ?? "Provider"} API Key</label>
            <div className="relative">
              <Input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(e) => onKeyChange(e.target.value)} autoComplete="off" spellCheck={false}
                placeholder={activeProvider?.id === "openai" ? "sk-..." : activeProvider?.id === "deepgram" ? "Token..." : "gsk_..."} className="pr-11 font-mono" />
              <button type="button" onClick={onToggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink">
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        <div className="h-px bg-line" />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Formatting Provider</label>
          <Select value={settings.formattingProvider} onChange={onLlmProviderChange} options={llmProviders.map((p) => ({ value: p.id, label: p.name }))} />
        </div>

        {showLlmKeyInput && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">{activeLlm?.name ?? "Provider"} API Key</label>
            <div className="relative">
              <Input type={showLlmApiKey ? "text" : "password"} value={llmApiKey} onChange={(e) => onLlmKeyChange(e.target.value)} autoComplete="off" spellCheck={false}
                placeholder={activeLlm?.id === "anthropic" ? "sk-ant-..." : "sk-..."} className="pr-11 font-mono" />
              <button type="button" onClick={onToggleLlmShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink">
                {showLlmApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        {isValid && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent">
            <CheckCircle2 size={13} /> API key saved — you&apos;re ready to dictate
          </motion.div>
        )}

        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="mb-2 text-xs font-semibold text-ink">How to get a Groq key (free)</p>
          <ol className="list-inside list-decimal space-y-1 text-xs text-muted">
            <li>Go to <span className="font-medium text-ink">console.groq.com</span></li>
            <li>Sign up or log in</li>
            <li>Navigate to <span className="font-medium text-ink">API Keys</span> and create one</li>
            <li>Paste it above</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

const HOTKEY_MOD_SYMBOL: Record<string, string> = { Cmd: "⌘", Ctrl: "⌃", Option: "⌥", Shift: "⇧" };
const HOTKEY_MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
const HOTKEY_MODIFIER_LABEL: Record<string, string> = { Meta: "Cmd", Control: "Ctrl", Alt: "Option", Shift: "Shift" };

function HotkeySlide({ primaryHotkey, onChange }: { primaryHotkey: string; onChange: (v: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);

  const stopEditing = useCallback(() => { void window.vaani.setHotkeyCapture(false); setIsEditing(false); setPreview([]); }, []);
  const startEditing = useCallback(() => { void window.vaani.setHotkeyCapture(true); setPreview([]); setIsEditing(true); }, []);

  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { stopEditing(); return; }
      const mods: string[] = [];
      if (e.metaKey) mods.push("Cmd");
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Option");
      if (e.shiftKey) mods.push("Shift");
      if (HOTKEY_MODIFIER_KEYS.has(e.key)) { setPreview([HOTKEY_MODIFIER_LABEL[e.key] ?? e.key]); return; }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      onChange([...mods, key].join("+"));
      stopEditing();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", stopEditing);
    return () => { window.removeEventListener("keydown", onKeyDown, true); window.removeEventListener("blur", stopEditing); };
  }, [isEditing, onChange, stopEditing]);

  useEffect(() => () => { void window.vaani.setHotkeyCapture(false); }, []);

  const displayKeys = primaryHotkey.split("+").filter(Boolean);

  return (
    <div className="flex flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><Keyboard size={26} /></SlideIcon>
      <h2 className="text-display mb-2 text-3xl text-ink">Your Shortcut</h2>
      <p className="mb-8 text-sm text-muted">Choose the key combination you will press to start dictating.</p>

      <div className="w-full rounded-2xl border border-line bg-surface p-5">
        {!isEditing ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              {displayKeys.map((k, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="inline-flex min-w-[36px] items-center justify-center rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm font-bold text-ink">{HOTKEY_MOD_SYMBOL[k] ?? k}</span>
                  {i < displayKeys.length - 1 && <span className="text-xs text-faint">+</span>}
                </span>
              ))}
            </div>
            <Button variant="soft" size="sm" onClick={startEditing}><Pencil size={14} /> Change</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-accent">Press your new shortcut…</p>
              <button onClick={stopEditing} className="text-xs text-muted transition-colors hover:text-ink">Cancel</button>
            </div>
            <div className="flex min-h-[40px] items-center gap-1.5">
              {preview.length > 0 ? preview.map((k, i) => (
                <span key={i} className="inline-flex min-w-[36px] items-center justify-center rounded-lg border border-accent bg-accent/10 px-2.5 py-1.5 font-mono text-sm font-bold text-accent">{HOTKEY_MOD_SYMBOL[k] ?? k}</span>
              )) : <span className="text-xs text-faint">Hold modifiers (⌃⌥⇧⌘) then press a key</span>}
            </div>
          </div>
        )}
        <p className="mt-3 text-left text-xs text-faint"><Volume2 size={10} className="mr-1 inline" /> You can also change this anytime in Settings</p>
      </div>
    </div>
  );
}

function FeaturesSlide() {
  const features = [
    { icon: <Sparkles size={18} />, title: "Smart Cleanup", desc: "Removes filler words and adds punctuation automatically.", tone: "bg-accent/10 text-accent" },
    { icon: <BookOpen size={18} />, title: "Custom Dictionary", desc: "Teach Vaani names, brands, and words you use often.", tone: "bg-accent/10 text-accent" },
    { icon: <FileText size={18} />, title: "Snippets", desc: "Type shortcuts like /address to expand full text blocks.", tone: "bg-accent/10 text-accent" },
    { icon: <BarChart3 size={18} />, title: "History & Insights", desc: "Track your dictation habits, word counts, and streaks.", tone: "bg-accent/10 text-accent" },
  ];
  return (
    <div className="flex flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><Sparkles size={26} /></SlideIcon>
      <h2 className="text-display mb-2 text-3xl text-ink">Power Features</h2>
      <p className="mb-8 text-sm text-muted">Explore these anytime from the sidebar.</p>
      <div className="grid w-full grid-cols-2 gap-3">
        {features.map((f, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}
            className="flex flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left">
            <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${f.tone}`}>{f.icon}</div>
            <div className="text-sm font-semibold text-ink">{f.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted">{f.desc}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const DEMO_EXAMPLE_PHRASE = "Vaani makes dictation feel effortless.";

function demoHotkeyHint(mode: DictationMode): string {
  if (mode === "push-to-talk") return "Hold your shortcut while you speak, then release.";
  if (mode === "toggle-double") return "Double-press your shortcut to start, speak, then double-press again to stop.";
  return "Press your shortcut to start, speak, then press again to stop.";
}

function HotkeyBadges({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-xs font-medium text-faint">+</span>}
          <span className="inline-flex min-w-[36px] items-center justify-center rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-sm font-bold text-ink">{HOTKEY_MOD_SYMBOL[k] ?? k}</span>
        </span>
      ))}
    </div>
  );
}

function DemoSlide({ primaryHotkey, dictationMode }: { primaryHotkey: string; dictationMode: DictationMode }) {
  const [practicePhrase, setPracticePhrase] = useState("");
  const [transcription, setTranscription] = useState("");
  const [phase, setPhase] = useState<"idle" | "active" | "transcribing">("idle");
  const [error, setError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayKeys = primaryHotkey.split("+").filter(Boolean);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const clip = await blobToClip(blob);
          setTranscription(await window.vaani.demoTranscribe(clip));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Demo transcription failed");
        } finally {
          setPhase("idle");
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
      recorder.start();
      setPhase("active"); setError(""); setTranscription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access microphone");
    }
  }, []);

  const stopRecording = useCallback(() => { mediaRecorderRef.current?.stop(); }, []);

  useEffect(() => () => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const statusLabel = phase === "active" ? "Listening…" : phase === "transcribing" ? "Transcribing…" : transcription ? "Done — try again anytime" : "Press Record to try your shortcut";
  const isRecording = phase === "active";

  return (
    <div className="flex w-full flex-col items-center text-center">
      <SlideIcon tone="bg-accent/10 text-accent"><Keyboard size={24} /></SlideIcon>
      <h2 className="text-display mb-1 text-3xl text-ink">Try Your Shortcut</h2>
      <p className="mb-4 text-sm text-muted">Press Record and speak your phrase — just like real dictation.</p>

      <div className="mb-4 w-full rounded-2xl border border-line bg-surface p-4">
        <HotkeyBadges keys={displayKeys} />
        <p className="mt-3 text-xs leading-relaxed text-muted">{demoHotkeyHint(dictationMode)}</p>
        <button type="button" onClick={isRecording ? stopRecording : startRecording} disabled={phase === "transcribing"}
          className={`mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
            isRecording ? "bg-red-500 text-white hover:bg-red-600" : phase === "transcribing" ? "cursor-wait bg-line text-faint" : "bg-accent text-white hover:bg-accent-strong"
          }`}>
          {isRecording ? (
            <><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" /></span> Stop</>
          ) : phase === "transcribing" ? (
            <><Loader2 size={14} className="animate-spin-ui" /> Transcribing…</>
          ) : (
            <><Mic size={14} /> Record</>
          )}
        </button>
        <p className={`mt-2 text-xs font-medium ${phase === "active" ? "animate-pulse text-accent" : phase === "transcribing" ? "text-muted" : transcription ? "text-accent" : "text-faint"}`}>{statusLabel}</p>
      </div>

      <div className="mb-3 w-full text-left">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-muted">Phrase to dictate</label>
          <button type="button" onClick={() => { setPracticePhrase(DEMO_EXAMPLE_PHRASE); setTranscription(""); setError(""); }} className="text-xs font-medium text-accent transition-colors hover:text-accent-strong">Use example</button>
        </div>
        <textarea value={practicePhrase} onChange={(e) => setPracticePhrase(e.target.value)} placeholder={DEMO_EXAMPLE_PHRASE} rows={2}
          className="w-full resize-none rounded-2xl border border-line bg-bg px-4 py-2.5 text-sm text-ink outline-none transition-all placeholder:text-faint focus:border-accent" />
      </div>

      {(transcription || phase === "transcribing") && (
        <div className="w-full text-left">
          <label className="mb-1 block text-xs font-medium text-muted">Transcription</label>
          <div className="min-h-[52px] rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm leading-relaxed text-ink">
            {phase === "transcribing" ? <span className="inline-flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin-ui" /> Transcribing…</span> : transcription}
          </div>
        </div>
      )}

      {error && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mt-3 w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left">
          <p className="text-xs leading-relaxed text-red-600">{error}</p>
        </motion.div>
      )}
    </div>
  );
}

function ReadySlide() {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-accent">
        <CheckCircle2 size={36} />
      </motion.div>
      <h2 className="text-display mb-2 text-3xl text-ink">You are all set!</h2>
      <p className="max-w-xs text-sm leading-relaxed text-muted">Press your hotkey anytime to start dictating. Vaani is ready when you are.</p>
      <div className="mt-8 flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><History size={18} /></div>
        <div className="text-left">
          <div className="text-sm font-medium text-ink">Reopen this guide</div>
          <div className="text-xs text-muted">Settings → Reset Onboarding</div>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({
  icon, title, description, granted, disabled, actionLabel, onAction,
}: {
  icon: React.ReactNode; title: string; description: string; granted: boolean; disabled: boolean; actionLabel: string; onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-bg p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-muted">{icon}</div>
      <div className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <p className="text-xs leading-snug text-muted">{description}</p>
      </div>
      {granted ? (
        <div className="flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-2 text-sm font-semibold text-accent"><CheckCircle2 size={15} /> Enabled</div>
      ) : (
        <button onClick={onAction} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50">
          {disabled && <Loader2 size={14} className="animate-spin-ui" />} {actionLabel}
        </button>
      )}
    </div>
  );
}
