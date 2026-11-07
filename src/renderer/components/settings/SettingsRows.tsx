import type { ReactNode } from "react";
import type {
  Settings,
  PermissionStatus,
  AudioInputDevice,
  DictationEntry,
} from "@shared/types";
import type { ProviderInfo } from "@shared/defaults";
import type { useDictateTip } from "@renderer/hooks/useDictateTip";
import type { useVaaniUi } from "@renderer/context/vaani-ui";

export interface SettingsPanelContext {
  settings: Settings;
  updateSettings: ReturnType<typeof useVaaniUi>["updateSettings"];
  resetSettings: ReturnType<typeof useVaaniUi>["resetSettings"];
  clearHistory: ReturnType<typeof useVaaniUi>["clearHistory"];
  historyEntries: DictationEntry[];
  updateStatus: ReturnType<typeof useVaaniUi>["updateStatus"];
  checkForUpdates: ReturnType<typeof useVaaniUi>["checkForUpdates"];
  restartAndInstall: ReturnType<typeof useVaaniUi>["restartAndInstall"];
  dictionaryCount: number;
  snippetCount: number;
  mode: "light" | "dark";
  setMode: (mode: "light" | "dark") => void;
  tip: ReturnType<typeof useDictateTip>;
  version: string;
  devices: AudioInputDevice[];
  permissions: PermissionStatus;
  setPermissions: (status: PermissionStatus) => void;
  whisperModels: string[];
  expandedProfile: string | null;
  setExpandedProfile: (id: string | null) => void;
  addingProfile: boolean;
  setAddingProfile: (value: boolean) => void;
  profileName: string;
  setProfileName: (value: string) => void;
  profileBundle: string;
  setProfileBundle: (value: string) => void;
  fillerDraft: string;
  setFillerDraft: (value: string) => void;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  editingKey: string | null;
  setEditingKey: (id: string | null) => void;
  keyDrafts: Record<string, string>;
  setKeyDrafts: (drafts: Record<string, string>) => void;
  testingProvider: string | null;
  permissionsBusy: keyof PermissionStatus | null;
  hotkeyEditing: "primary" | "paste" | null;
  setHotkeyEditing: (value: "primary" | "paste" | null) => void;
  setPermissionsBusy: (permission: keyof PermissionStatus | null) => void;
  addProfile: () => void;
  patchProfile: (
    id: string,
    patch: Partial<NonNullable<Settings["appProfiles"]>[number]>,
  ) => void;
  saveKey: (providerId: string, key: string) => Promise<void>;
  testKey: (providerId: string, key?: string) => Promise<void>;
  permissionAction: (permission: keyof PermissionStatus) => Promise<void>;
  exportHistory: () => void;
  openDictionary: () => void;
  keyProviders: ProviderInfo[];
  sttProviders: ProviderInfo[];
  llmProviders: ProviderInfo[];
  profileLanguageOptions: { value: string; label: string }[];
  languageOptions: { value: string; label: string }[];
  micOptions: { value: string; label: string }[];
}

// Renders a setting label and its control.
export function Row({
  title,
  description,
  children,
  wide = false,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      data-setting-row
      className={`flex ${wide ? "flex-col items-stretch gap-3" : "items-center gap-5"} border-b border-line py-[15px] last:border-b-0 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {description && (
          <p className="mt-[3px] text-[12.5px] leading-[1.45] text-muted">
            {description}
          </p>
        )}
      </div>
      <div className={wide ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

// Groups related settings under a compact label.
export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-5">
      <h3 className="label-meta mb-1 text-[10px] text-faint">{title}</h3>
      {children}
    </section>
  );
}

// Shows options as equal-width radio cards.
export function OptionCards<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; description: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="grid grid-cols-3 gap-2 @max-[600px]/pane:grid-cols-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`relative min-h-[82px] rounded-[16px] border p-3 text-left transition-colors ${value === option.value ? "border-accent bg-accent/10" : "border-line bg-card hover:border-ink/25"}`}
        >
          <span
            aria-hidden="true"
            className={`absolute left-3 top-3 size-4 rounded-full border ${value === option.value ? "border-[5px] border-accent" : "border-faint"}`}
          />
          <b className="ml-6 block text-[13px] text-ink">{option.label}</b>
          <span className="ml-6 mt-1 block text-[11.5px] leading-snug text-muted">
            {option.description}
          </span>
        </button>
      ))}
    </div>
  );
}

// Renders one data action with its label and button.
export function DataAction({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] bg-surface p-3">
      <span className="grid size-8 place-items-center rounded-full bg-card">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13px]">{title}</b>
        <small className="text-[11px] text-muted">{description}</small>
      </span>
      <button
        type="button"
        onClick={onClick}
        className="rounded-full px-3 py-1.5 text-[12px] font-semibold hover:bg-card"
      >
        {actionLabel}
      </button>
    </div>
  );
}

export type SectionComponentProps = { context: SettingsPanelContext };
