import { Search, X } from "lucide-react";
import GeneralSection from "./GeneralSection";
import PermissionsSection from "./PermissionsSection";
import ApiSection from "./ApiSection";
import LanguageSection from "./LanguageSection";
import DictationSection from "./DictationSection";
import ShortcutsSection from "./ShortcutsSection";
import InsertionSection from "./InsertionSection";
import AppearanceSection from "./AppearanceSection";
import DataSection from "./DataSection";
import { useSettingsPanelState } from "./useSettingsPanelState";

const sectionComponents = {
  general: GeneralSection,
  permissions: PermissionsSection,
  api: ApiSection,
  language: LanguageSection,
  dictation: DictationSection,
  hotkey: ShortcutsSection,
  injection: InsertionSection,
  appearance: AppearanceSection,
  data: DataSection,
};

// Renders the settings dialog, navigation and selected settings section.
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const panel = useSettingsPanelState(onClose);
  const Section = sectionComponents[panel.section];

  if (!panel.isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>
        {
          "@keyframes settings-enter{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}.settings-hit{background:color-mix(in srgb,var(--color-accent) 9%,transparent);border-radius:12px;transition:background-color .7s}"
        }
      </style>
      <section
        ref={panel.dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={panel.handleKeyDown}
        className="grid h-[min(680px,calc(100vh-66px))] w-[min(940px,calc(100vw-40px))] grid-cols-[232px_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-bg text-ink shadow-[0_44px_110px_-24px_rgba(0,0,0,.55)] outline-none max-[900px]:grid-cols-[180px_minmax(0,1fr)] animate-[settings-enter_.22s_cubic-bezier(.2,1,.4,1)]"
      >
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-side px-3 py-7">
          <h1
            id="settings-title"
            className="text-display mb-4 px-2 text-[28px] text-ink"
          >
            Settings
          </h1>
          <label className="mb-3 flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3 text-muted">
            <Search size={14} />
            <input
              value={panel.query}
              onChange={(event) => panel.setQuery(event.target.value)}
              placeholder="Find a setting"
              aria-label="Find a setting"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
          </label>
          <nav aria-label="Settings sections" className="grid gap-1">
            {panel.filteredSections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={panel.section === item.id ? "page" : undefined}
                  onClick={() => panel.setSection(item.id)}
                  className={`flex min-h-9 items-center gap-2 rounded-full px-2.5 text-left text-[12.5px] transition-colors ${panel.section === item.id ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-bg hover:text-ink"}`}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  {item.label}
                </button>
              );
            })}
            {panel.filteredSections.length === 0 && (
              <p className="px-2 py-2 text-[12px] text-muted">
                No settings match.
              </p>
            )}
          </nav>
        </aside>
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <button
            type="button"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 grid size-7 place-items-center rounded-full bg-surface text-muted hover:bg-line hover:text-ink"
          >
            <X size={15} />
          </button>
          <div
            ref={panel.paneRef}
            className="min-h-0 flex-1 overflow-auto px-8 pb-8 pt-7 @container/pane [mask-image:linear-gradient(to_bottom,transparent_0,#000_22px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,#000_22px)]"
          >
            <header className="pb-4 pr-14">
              <h2 className="text-display text-[36px] leading-none text-ink">
                {panel.currentSection.label}
              </h2>
              <p className="mt-2 text-[12.5px] text-muted">
                {panel.currentSection.description}
              </p>
            </header>
            <Section context={panel.context} />
          </div>
        </div>
      </section>
    </div>
  );
}
