import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { Snippet } from "@shared/types";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import { useSettingsPanel } from "@renderer/context/settings-panel";
import AppIcon from "@renderer/components/ui/AppIcon";
import PageHeader from "@renderer/components/ui/PageHeader";
import SearchField from "@renderer/components/ui/SearchField";
import { Button } from "@renderer/components/ui/button";
import { Toggle } from "@renderer/components/ui/toggle";
import { Tag } from "@renderer/components/ui/tag";
import { Input, Textarea } from "@renderer/components/ui/input";
import { hasSnippetScopeConflict, matchesSnippetQuery } from "@renderer/lib/listRows";
import { normalizeAppProfileIds, normalizeSnippetTrigger } from "@shared/textRuleEdits";
import { cn } from "@renderer/lib/utils";

const NEW_SNIPPET = -1;
type SnippetDraft = { trigger: string; content: string; matchBareTrigger: boolean; appProfileIds: string[]; allApps: boolean };

// Renders snippets as expandable rows with inline editing.
export default function Snippets() {
  const { settings, updateSettings } = useVaaniUi();
  const settingsPanel = useSettingsPanel();
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<SnippetDraft | null>(null);
  const [triggerError, setTriggerError] = useState("");
  const [bodyError, setBodyError] = useState("");
  const snippets = settings.snippets;
  const profiles = settings.appProfiles ?? [];
  const visibleSnippets = useMemo(() => snippets.filter((snippet) => matchesSnippetQuery(snippet, query)), [snippets, query]);

  useEffect(() => {
    if (openIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openIndex]);

  const close = () => { setOpenIndex(null); setDraft(null); setTriggerError(""); setBodyError(""); };
  const startNew = () => { setOpenIndex(NEW_SNIPPET); setDraft({ trigger: "", content: "", matchBareTrigger: false, appProfileIds: [], allApps: true }); setTriggerError(""); setBodyError(""); };
  const startEdit = (index: number, snippet: Snippet) => {
    const ids = normalizeAppProfileIds(snippet.appProfileIds);
    setOpenIndex(index);
    setDraft({ trigger: snippet.trigger, content: snippet.content, matchBareTrigger: snippet.matchBareTrigger === true, appProfileIds: ids ?? [], allApps: ids === undefined });
    setTriggerError(""); setBodyError("");
  };
  const changeDraft = (patch: Partial<SnippetDraft>) => { setDraft((current) => current ? { ...current, ...patch } : current); setTriggerError(""); setBodyError(""); };
  const save = () => {
    if (!draft || openIndex === null) return;
    const trigger = normalizeSnippetTrigger(draft.trigger);
    const content = draft.content.trim();
    if (!trigger) { setTriggerError("Add a trigger."); return; }
    if (!content) { setBodyError("Add the text this snippet should paste."); return; }
    if (!draft.allApps && draft.appProfileIds.length === 0) { setTriggerError("Pick at least one app profile, or turn on all apps."); return; }
    const ids = draft.allApps ? undefined : normalizeAppProfileIds(draft.appProfileIds);
    if (hasSnippetScopeConflict(snippets, trigger, ids, openIndex === NEW_SNIPPET ? undefined : openIndex)) {
      setTriggerError("This trigger is already used in these apps. Choose another trigger or change where it works."); return;
    }
    const nextItem: Snippet = { trigger, content, matchBareTrigger: draft.matchBareTrigger, ...(ids === undefined ? {} : { appProfileIds: ids }) };
    const next = openIndex === NEW_SNIPPET ? [...snippets, nextItem] : snippets.map((item, index) => index === openIndex ? nextItem : item);
    void updateSettings({ snippets: next });
    if (openIndex === NEW_SNIPPET) setQuery("");
    close();
  };
  const remove = () => {
    if (openIndex === null || openIndex === NEW_SNIPPET) return;
    void updateSettings({ snippets: snippets.filter((_, index) => index !== openIndex) });
    close();
  };
  const scopeName = (snippet: Snippet) => {
    const ids = normalizeAppProfileIds(snippet.appProfileIds);
    if (ids === undefined) return "All apps";
    return profiles.filter((profile) => ids.includes(profile.id)).map((profile) => profile.name).join(", ") || "No apps";
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Snippets" subtitle="Say “slash” and a trigger. Vaani pastes the full text."><Button onClick={startNew}><Plus />New snippet</Button></PageHeader>
    <div className="mb-4 shrink-0"><SearchField value={query} onChange={setQuery} placeholder="Search snippets…" className="w-[340px] max-w-full" /></div>
    <section aria-label="Snippets" className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-card p-2">
      {visibleSnippets.length === 0 && openIndex !== NEW_SNIPPET ? <p className="px-4 py-12 text-center text-sm text-muted">No snippets match.</p> : <>
        {openIndex === NEW_SNIPPET && draft && <SnippetRow snippet={null} draft={draft} isOpen onOpen={() => {}} onChange={changeDraft} onSave={save} onCancel={close} onDelete={remove} onOpenSettings={() => { close(); settingsPanel.open("language"); }} triggerError={triggerError} bodyError={bodyError} profiles={profiles} scopeName={scopeName} />}
        {visibleSnippets.map((snippet) => {
          const index = snippets.indexOf(snippet);
          return <SnippetRow key={`${snippet.trigger}-${index}`} snippet={snippet} draft={openIndex === index ? draft : null} isOpen={openIndex === index} onOpen={() => openIndex === index ? close() : startEdit(index, snippet)} onChange={changeDraft} onSave={save} onCancel={close} onDelete={remove} onOpenSettings={() => { close(); settingsPanel.open("language"); }} triggerError={openIndex === index ? triggerError : ""} bodyError={openIndex === index ? bodyError : ""} profiles={profiles} scopeName={scopeName} />;
        })}
      </>}
    </section>
  </div>;
}

// Renders one snippet row and its editor.
function SnippetRow({ snippet, draft, isOpen, onOpen, onChange, onSave, onCancel, onDelete, onOpenSettings, triggerError, bodyError, profiles, scopeName }: {
  snippet: Snippet | null;
  draft: SnippetDraft | null;
  isOpen: boolean;
  onOpen: () => void;
  onChange: (patch: Partial<SnippetDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onOpenSettings: () => void;
  triggerError: string;
  bodyError: string;
  profiles: NonNullable<ReturnType<typeof useVaaniUi>["settings"]["appProfiles"]>;
  scopeName: (snippet: Snippet) => string;
}) {
  const content = draft?.content ?? snippet?.content ?? "";
  const compactPreview = content.split("\n").map((line) => line.replace(/,$/, "")).filter(Boolean).join(" · ");
  const selectedProfiles = draft?.appProfileIds ?? [];
  const updateProfile = (id: string, enabled: boolean) => onChange({ appProfileIds: enabled ? [...selectedProfiles, id] : selectedProfiles.filter((profileId) => profileId !== id) });
  return <article className={cn("rounded-[18px]", isOpen && "bg-surface")}>
    <button type="button" onClick={onOpen} aria-expanded={isOpen} aria-controls={snippet ? `snippet-${encodeURIComponent(snippet.trigger)}` : "snippet-new"} className={cn("grid w-full grid-cols-[150px_minmax(0,1fr)_auto_16px] items-center gap-3.5 rounded-[18px] px-4 py-3.5 text-left hover:bg-surface @max-[720px]/main:grid-cols-[100px_minmax(0,1fr)_16px]", isOpen && "hover:bg-blush")}>
      <span className="truncate font-display text-[23px] font-extrabold tracking-[-.03em] text-ink"><span className="text-accent">/</span>{snippet?.trigger ?? draft?.trigger ?? "trigger"}</span>
      <span className="min-w-0 truncate text-[13px] text-muted">{snippet ? <>{compactPreview || "Empty snippet"}{snippet.matchBareTrigger && <span className="text-faint"> · no slash</span>}</> : "New snippet"}</span>
      {snippet && <Tag tone={snippet.appProfileIds?.length ? "sky" : "mint"} className="@max-[720px]/main:hidden">{scopeName(snippet)}</Tag>}
      <ChevronDown size={15} className={cn("text-faint transition-transform", isOpen && "rotate-180")} />
    </button>
    {isOpen && draft && <div id={snippet ? `snippet-${encodeURIComponent(snippet.trigger)}` : "snippet-new"} role="region" aria-label={snippet ? `Edit snippet /${snippet.trigger}` : "New snippet"} className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3 px-3 pb-4 @max-[860px]/main:grid-cols-1">
      <div className="rounded-2xl bg-card p-4">
        <label className="block"><span className="label-meta mb-1.5 block text-[10px] text-faint">Trigger</span><span className="flex h-[42px] items-center rounded-xl border border-line bg-bg px-3 font-mono text-[15px] font-semibold text-accent"><span>/</span><Input aria-label="Trigger" value={draft.trigger} onChange={(event) => onChange({ trigger: event.target.value.replace(/^\//, "") })} placeholder="trigger" className="border-0 bg-transparent p-0 font-inherit text-ink shadow-none focus-visible:ring-0" /></span></label>
        {triggerError && <p role="alert" className="mt-1.5 text-xs text-red-600">{triggerError}</p>}
        <label className="mt-3 block"><span className="label-meta mb-1.5 block text-[10px] text-faint">Expands to</span><Textarea aria-label="Expands to" value={draft.content} onChange={(event) => onChange({ content: event.target.value })} placeholder="What Vaani pastes" rows={4} className="resize-y font-mono text-[13px] leading-relaxed" /></label>
        {bodyError && <p role="alert" className="mt-1.5 text-xs text-red-600">{bodyError}</p>}
      </div>
      <div className="rounded-2xl bg-card p-4">
        <div className="flex items-center gap-3"><Toggle checked={draft.matchBareTrigger} onChange={(matchBareTrigger) => onChange({ matchBareTrigger })} aria-label="Allow trigger without slash" /><span className="text-[13px] font-semibold text-ink">Allow trigger without slash<small className="mt-0.5 block text-[11.5px] font-normal leading-relaxed text-muted">{draft.trigger ? `Say just “${draft.trigger}” without “slash”.` : "Say the trigger without “slash”."} Pick a word you never say in normal speech.</small></span></div>
        <div className="mt-4 flex items-center gap-3"><Toggle checked={draft.allApps} onChange={(allApps) => onChange({ allApps, appProfileIds: allApps ? [] : draft.appProfileIds })} aria-label="Available in all apps" /><span className="text-[13px] font-semibold text-ink">Available in all apps</span></div>
        {!draft.allApps && <div className="mt-3 flex flex-wrap gap-2">{profiles.map((profile) => <button type="button" key={profile.id} aria-pressed={selectedProfiles.includes(profile.id)} onClick={() => updateProfile(profile.id, !selectedProfiles.includes(profile.id))} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-2 text-xs font-semibold text-muted", selectedProfiles.includes(profile.id) && "border-accent bg-accent/10 text-ink")}><AppIcon name={profile.name} bundleId={profile.appBundleIds[0]} size={22} />{profile.name}</button>)}</div>}
        {!draft.allApps && profiles.length === 0 && <p className="mt-3 text-xs text-muted">Add app profiles in Settings › Language to limit a snippet. <button type="button" className="font-semibold text-accent underline underline-offset-2" onClick={onOpenSettings}>Open Language settings</button></p>}
        <div className="mt-4 rounded-2xl bg-[#121214] px-4 py-3 text-[12.5px] leading-relaxed text-[#f3f3f5]"><span className="text-white/50">{draft.trigger ? `Say “slash ${draft.trigger}” →` : "Add a trigger to preview"}</span><p className="mt-1.5 whitespace-pre-line text-white/85">{draft.content || "…"}</p></div>
      </div>
      <div className="col-span-full flex items-center gap-2 @max-[860px]/main:col-span-1"><Button size="sm" onClick={onSave}>{snippet ? "Save" : "Add snippet"}</Button><Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><span className="flex-1" />{snippet && <Button variant="danger" size="sm" onClick={onDelete}><Trash2 />Delete</Button>}</div>
    </div>}
  </article>;
}
