import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import { useColorMode } from "@renderer/context/color-mode";
import { useSettingsPanel } from "@renderer/context/settings-panel";
import { useDictateTip } from "@renderer/hooks/useDictateTip";
import { decideProviderKeyDraft } from "@renderer/lib/providerKeyDraft";
import { createExportPayload } from "@renderer/exportData";
import { pickerEntries } from "@shared/modelList";
import {
  KNOWN_PROVIDERS,
  SUPPORTED_LANGUAGES,
  getLanguageLabel,
} from "@shared/defaults";
import type {
  AudioInputDevice,
  PermissionStatus,
  Settings,
} from "@shared/types";
import { settingsSections } from "./settingsSections";
import type { SettingsPanelContext } from "./SettingsRows";

const languages = SUPPORTED_LANGUAGES.map((language) => ({
  value: language.value,
  label: language.label,
}));

// Owns settings panel data, actions and keyboard behavior.
export function useSettingsPanelState(onClose: () => void) {
  const { isOpen, section, setSection } = useSettingsPanel();
  const ui = useVaaniUi();
  const { mode, setMode } = useColorMode();
  const navigate = useNavigate();
  const tip = useDictateTip(ui.historyEntries.length);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState("");
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: "unknown",
    accessibility: "unknown",
  });
  const [whisperModels, setWhisperModels] = useState<string[]>([]);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBundle, setProfileBundle] = useState("");
  const [fillerDraft, setFillerDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState(
    ui.settings.customPrompt ?? "",
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [permissionsBusy, setPermissionsBusy] = useState<
    keyof PermissionStatus | null
  >(null);
  const [hotkeyEditing, setHotkeyEditing] = useState<
    "primary" | "paste" | null
  >(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const currentSection =
    settingsSections.find((item) => item.id === section) ??
    settingsSections[0]!;
  const profiles = ui.settings.appProfiles ?? [];
  const sttProviders = KNOWN_PROVIDERS.filter(
    (provider) =>
      !provider.hidden &&
      (provider.type === "stt" || provider.type === "local-stt"),
  );
  const llmProviders = KNOWN_PROVIDERS.filter(
    (provider) => provider.type === "llm",
  );
  const keyProviders = KNOWN_PROVIDERS.filter(
    (provider) => provider.requiresApiKey && !provider.hidden,
  );
  const profileLanguageOptions = [
    {
      value: "",
      label: `Use global (${getLanguageLabel(ui.settings.language) ?? ui.settings.language})`,
    },
    ...languages.filter((language) => language.value !== "auto"),
  ];
  const micOptions = [
    { value: "", label: "Automatic built-in microphone" },
    ...devices
      .filter((device) => device.isPhysical)
      .map((device) => ({
        value: device.uid,
        label: `${device.name || "Microphone"}${device.isDefault ? " (Default)" : ""}`,
      })),
  ];
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return settingsSections;
    const providerNames = KNOWN_PROVIDERS.map(
      (provider) => `${provider.name} ${provider.id}`,
    ).join(" ");
    const keyNames = (ui.settings.providerApiKeys ?? [])
      .map((key) => key.providerId)
      .join(" ");
    const profileText = profiles
      .map(
        (profile) =>
          `${profile.name} ${profile.appBundleIds.join(" ")} ${profile.language ?? ""}`,
      )
      .join(" ");
    const modelNames = [
      ...pickerEntries("transcription"),
      ...pickerEntries("cleanup"),
    ]
      .map((entry) => `${entry.displayName} ${entry.modelId}`)
      .join(" ");
    const searchableBySection: Record<string, string> = {
      general: `${ui.settings.launchAtLogin} ${ui.settings.showInDock} account sync startup Dock updates version check now`,
      permissions:
        "microphone accessibility granted not granted macOS System Settings",
      api: `${ui.settings.transcriptionProvider} ${ui.settings.transcriptionModel} ${ui.settings.formattingProvider} ${ui.settings.formattingModel} ${ui.settings.localWhisperModel} ${providerNames} ${keyNames} ${modelNames} ${whisperModels.join(" ")} transcription cleanup dictionary snippets failover processing mode cloud local whisper model API key`,
      language: `${ui.settings.language} ${ui.settings.fillerWords.join(" ")} ${ui.settings.extraFillerWords.join(" ")} ${profileText} ${providerNames} ${languages.map((language) => language.label).join(" ")} default language app profiles smart punctuation cleanup context filler words instructions style preset`,
      dictation:
        "recording mode toggle push to talk smart toggle audio capture microphone save recordings folder suggest dictionary words low latency clip length silence threshold audio",
      hotkey: `${ui.settings.primaryHotkey} ${ui.settings.pasteLatestHotkey} dictate shortcut paste latest cancel dictation escape fn`,
      injection:
        "insertion auto accessibility API copy only paste mode animated instant",
      appearance: `${ui.settings.accentColor} theme light dark accent indigo pink teal amber home dictate card setup checklist`,
      data: "data dictations stored oldest entry export history clear history reset all settings",
    };
    return settingsSections.filter((item) =>
      `${item.label} ${item.description} ${searchableBySection[item.id] ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [query, ui.settings, profiles, whisperModels]);

  useEffect(() => {
    if (!isOpen) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    void window.vaani
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    void window.vaani
      .listAudioInputDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
    void window.vaani
      .whisperListModels()
      .then(setWhisperModels)
      .catch(() => setWhisperModels([]));
    void window.vaani
      .getPermissionStatus()
      .then(setPermissions)
      .catch(() => undefined);
    const unsubscribe =
      window.vaani.onPermissionStatusChanged?.(setPermissions);
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      unsubscribe?.();
      openerRef.current?.focus();
    };
  }, [isOpen]);
  useEffect(() => {
    setPromptDraft(ui.settings.customPrompt ?? "");
  }, [ui.settings.customPrompt]);
  useEffect(() => {
    if (!query.trim()) return;
    const hit = [
      ...(paneRef.current?.querySelectorAll<HTMLElement>(
        "[data-setting-row]",
      ) ?? []),
    ].find((row) =>
      row.textContent?.toLowerCase().includes(query.trim().toLowerCase()),
    );
    if (!hit) return;
    hit.scrollIntoView({ block: "nearest" });
    hit.classList.add("settings-hit");
    const timer = window.setTimeout(
      () => hit.classList.remove("settings-hit"),
      1100,
    );
    return () => window.clearTimeout(timer);
  }, [query, section, ui.settings]);
  // Handles Escape, command-W and focus trapping.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (hotkeyEditing) {
        setHotkeyEditing(null);
        event.preventDefault();
        return;
      }
      if (expandedProfile) {
        setExpandedProfile(null);
        event.preventDefault();
        return;
      }
      onClose();
      event.preventDefault();
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === "w") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !dialogRef.current?.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  // Adds a profile after checking its bundle id against existing profiles.
  function addProfile() {
    const bundleId = profileBundle.trim();
    if (
      !bundleId ||
      profiles.some((profile) =>
        profile.appBundleIds.some(
          (id) => id.toLowerCase() === bundleId.toLowerCase(),
        ),
      )
    )
      return;
    void ui.updateSettings({
      appProfiles: [
        ...profiles,
        {
          id: crypto.randomUUID(),
          name: profileName.trim() || bundleId,
          appBundleIds: [bundleId],
        },
      ],
    });
    setProfileName("");
    setProfileBundle("");
    setAddingProfile(false);
  }
  // Updates one existing app profile.
  function patchProfile(
    id: string,
    patch: Partial<NonNullable<Settings["appProfiles"]>[number]>,
  ) {
    void ui.updateSettings({
      appProfiles: profiles.map((profile) =>
        profile.id === id ? { ...profile, ...patch } : profile,
      ),
    });
  }
  // Saves an API key through the existing secure provider-key bridge.
  async function saveKey(providerId: string, key: string) {
    if (decideProviderKeyDraft(key, "blur") !== "save") return;
    await window.vaani.setProviderApiKey(providerId, key);
    await ui.updateSettings({});
  }
  // Tests an API key and refreshes its saved validation state.
  async function testKey(
    providerId: string,
    key = keyDrafts[providerId] ?? "",
  ) {
    if (!key.trim()) return;
    setTestingProvider(providerId);
    try {
      await saveKey(providerId, key);
      await window.vaani.testApiKey(providerId, key);
      await ui.updateSettings({});
      setEditingKey(null);
      setKeyDrafts({ ...keyDrafts, [providerId]: "" });
    } finally {
      setTestingProvider(null);
    }
  }
  // Requests or opens the macOS permission pane for one permission.
  async function permissionAction(permission: keyof PermissionStatus) {
    setPermissionsBusy(permission);
    try {
      if (permissions[permission] === "granted")
        await window.vaani.openPermissionSettings(permission);
      else if (permission === "microphone")
        await window.vaani.requestMicrophonePermission();
      else await window.vaani.requestAccessibilityPermission();
      setPermissions(await window.vaani.getPermissionStatus());
    } finally {
      setPermissionsBusy(null);
    }
  }
  // Exports stored settings and dictations to a local JSON file.
  function exportHistory() {
    const payload = createExportPayload(ui.settings, ui.historyEntries);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  // Navigates to Dictionary after selecting Fix in the provider pipeline.
  function openDictionary() {
    onClose();
    navigate("/app/dictionary");
  }

  const context: SettingsPanelContext = {
    settings: ui.settings,
    updateSettings: ui.updateSettings,
    resetSettings: ui.resetSettings,
    clearHistory: ui.clearHistory,
    historyEntries: ui.historyEntries,
    updateStatus: ui.updateStatus,
    checkForUpdates: ui.checkForUpdates,
    restartAndInstall: ui.restartAndInstall,
    dictionaryCount: ui.dictionaryItems.length,
    snippetCount: ui.snippets.length,
    mode,
    setMode,
    tip,
    version,
    devices,
    permissions,
    setPermissions,
    whisperModels,
    expandedProfile,
    setExpandedProfile,
    addingProfile,
    setAddingProfile,
    profileName,
    setProfileName,
    profileBundle,
    setProfileBundle,
    fillerDraft,
    setFillerDraft,
    promptDraft,
    setPromptDraft,
    editingKey,
    setEditingKey,
    keyDrafts,
    setKeyDrafts,
    testingProvider,
    permissionsBusy,
    hotkeyEditing,
    setHotkeyEditing,
    setPermissionsBusy,
    addProfile,
    patchProfile,
    saveKey,
    testKey,
    permissionAction,
    exportHistory,
    openDictionary,
    keyProviders,
    sttProviders,
    llmProviders,
    profileLanguageOptions,
    micOptions,
  };

  return {
    isOpen,
    section,
    setSection,
    query,
    setQuery,
    filteredSections,
    currentSection,
    dialogRef,
    paneRef,
    context,
    handleKeyDown,
  };
}
