import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { CustomCorrection } from "@shared/types";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import PageHeader from "@renderer/components/ui/PageHeader";
import SearchField from "@renderer/components/ui/SearchField";
import { Segmented } from "@renderer/components/ui/Segmented";
import { Button } from "@renderer/components/ui/button";
import { Toggle } from "@renderer/components/ui/toggle";
import { Tag } from "@renderer/components/ui/tag";
import { Input } from "@renderer/components/ui/input";
import { matchesDictionaryFilter } from "@renderer/lib/listRows";
import { cn } from "@renderer/lib/utils";

type RuleFilter = "all" | "manual" | "auto" | "disabled";
type RuleDraft = Pick<CustomCorrection, "spoken" | "written" | "enabled" | "wholeWord" | "caseSensitive" | "fuzzy">;
const NEW_RULE = "__new_rule__";

// Renders dictionary rules in an expandable table.
export default function Dictionary() {
  const { settings, updateSettings } = useVaaniUi();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RuleFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rules = settings.customCorrections;
  const totalHits = rules.reduce((sum, rule) => sum + (rule.hitCount ?? 0), 0);
  const filtered = useMemo(() => rules.filter((rule) => matchesDictionaryFilter(rule, filter, query)), [rules, filter, query]);
  const counts = {
    all: rules.length,
    manual: rules.filter((rule) => rule.source !== "auto-suggested" && rule.enabled !== false).length,
    auto: rules.filter((rule) => rule.source === "auto-suggested" && rule.enabled !== false).length,
    disabled: rules.filter((rule) => rule.enabled === false).length,
  };
  const startNew = () => { setOpenKey(NEW_RULE); setDraft({ spoken: "", written: "", enabled: true, wholeWord: true, caseSensitive: false, fuzzy: false }); setError(null); };
  const openRule = (rule: CustomCorrection) => {
    if (openKey === rule.spoken) { setOpenKey(null); setDraft(null); setError(null); return; }
    setOpenKey(rule.spoken);
    setDraft({ spoken: rule.spoken, written: rule.written, enabled: rule.enabled !== false, wholeWord: rule.wholeWord !== false, caseSensitive: rule.caseSensitive === true, fuzzy: rule.fuzzy === true });
    setError(null);
  };
  const updateDraft = (patch: Partial<RuleDraft>) => { setDraft((current) => current ? { ...current, ...patch } : current); setError(null); };
  const cancel = () => { setOpenKey(null); setDraft(null); setError(null); };
  const save = () => {
    if (!draft) return;
    const spoken = draft.spoken.trim().replace(/\s+/g, " ");
    const written = draft.written.trim().replace(/\s+/g, " ");
    if (!spoken || !written) { setError("Add what you say and what to write."); return; }
    if (rules.some((rule) => rule.spoken.toLocaleLowerCase() === spoken.toLocaleLowerCase() && rule.spoken !== openKey)) { setError("A rule with this trigger already exists."); return; }
    const settingsDraft = { ...draft, spoken, written };
    const next = openKey === NEW_RULE ? [
      ...rules,
      { ...settingsDraft, source: "manual" as const },
    ] : rules.map((rule) => rule.spoken === openKey ? { ...rule, ...settingsDraft } : rule);
    void updateSettings({ customCorrections: next });
    if (openKey === NEW_RULE) setQuery("");
    cancel();
  };
  const remove = () => {
    if (!openKey || openKey === NEW_RULE) return;
    void updateSettings({ customCorrections: rules.filter((rule) => rule.spoken !== openKey) });
    cancel();
  };
  const toggleEnabled = (rule: CustomCorrection, enabled: boolean) => {
    void updateSettings({ customCorrections: rules.map((item) => item.spoken === rule.spoken ? { ...item, enabled } : item) });
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader eyebrow={`${rules.length} rules · ${totalHits} fixes`} title="Dictionary" subtitle="Words Vaani should always write your way. Rules run after cleanup.">
      <Button onClick={startNew}><Plus />New rule</Button>
    </PageHeader>
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
      <SearchField value={query} onChange={setQuery} placeholder="Search rules…" className="w-[340px] max-w-full" />
      <Segmented value={filter} onChange={(value) => setFilter(value as RuleFilter)} options={[
        { value: "all", label: `All ${counts.all}` }, { value: "manual", label: `Manual ${counts.manual}` },
        { value: "auto", label: `Auto ${counts.auto}` }, { value: "disabled", label: `Disabled ${counts.disabled}` },
      ]} />
    </div>
    <section aria-label="Dictionary rules" className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-card p-2">
      <div className="grid grid-cols-[minmax(110px,160px)_24px_minmax(0,1fr)_150px_46px_32px] items-center gap-3 border-b border-line px-3 py-3 text-[10px] text-faint label-meta @max-[720px]/main:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_40px_46px_32px]">
        <span>Spoken</span><span /><span>Written</span><span>Hits</span><span>On</span><span />
      </div>
      {openKey === NEW_RULE && draft && <RuleRow rule={null} draft={draft} isOpen onOpen={() => {}} onToggle={() => {}} onDraftChange={updateDraft} onSave={save} onCancel={cancel} onDelete={remove} error={error} />}
      {filtered.length === 0 && openKey !== NEW_RULE ? <p className="px-4 py-12 text-center text-sm text-muted">No rules match.</p> : filtered.map((rule) => <RuleRow key={rule.spoken} rule={rule} draft={openKey === rule.spoken ? draft : null} isOpen={openKey === rule.spoken} onOpen={() => openRule(rule)} onToggle={(enabled) => toggleEnabled(rule, enabled)} onDraftChange={updateDraft} onSave={save} onCancel={cancel} onDelete={remove} error={openKey === rule.spoken ? error : null} />)}
    </section>
  </div>;
}

// Renders one dictionary row and its matching and source controls.
function RuleRow({ rule, draft, isOpen, onOpen, onToggle, onDraftChange, onSave, onCancel, onDelete, error }: {
  rule: CustomCorrection | null;
  draft: RuleDraft | null;
  isOpen: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onDraftChange: (patch: Partial<RuleDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  error: string | null;
}) {
  const spoken = draft?.spoken ?? rule?.spoken ?? "";
  const written = draft?.written ?? rule?.written ?? "";
  const hits = rule?.hitCount ?? 0;
  const lastUsed = rule?.lastUsedAt ? new Date(rule.lastUsedAt).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : null;
  return <article className={cn("rounded-2xl", isOpen && "bg-surface")}>
    <div className={cn("grid min-h-[62px] grid-cols-[minmax(110px,160px)_24px_minmax(0,1fr)_150px_46px_32px] items-center gap-3 rounded-2xl px-3 transition-colors hover:bg-surface @max-[720px]/main:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_40px_46px_32px]", isOpen && "hover:bg-transparent")}>
      <button type="button" onClick={onOpen} className="contents text-left" aria-expanded={isOpen} aria-controls={rule ? `rule-${encodeURIComponent(rule.spoken)}` : "rule-new"}>
        <span className="min-w-0 truncate"><code className="font-mono text-[13px] text-ink">{spoken || <span className="text-faint">When I say</span>}</code></span>
        <ArrowRight size={15} className="text-faint" />
        <span className="min-w-0 truncate text-sm text-ink">{written || <span className="text-faint">{rule ? "" : "New rule"}</span>}{rule?.enabled === false && <Tag tone="surface" className="ml-2 py-0.5">Off</Tag>}</span>
        <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted"><i className="h-[5px] max-w-[64px] rounded-full bg-accent" style={{ width: `${Math.min(64, Math.max(4, hits * 2))}px` }} />{rule ? hits : "New"}</span>
      </button>
      {rule ? <Toggle checked={rule.enabled !== false} onChange={onToggle} aria-label={`Enable rule ${rule.spoken}`} /> : <span />}
      <button type="button" aria-label={rule ? `Details for ${rule.spoken}` : "New rule details"} onClick={onOpen} aria-expanded={isOpen} aria-controls={rule ? `rule-${encodeURIComponent(rule.spoken)}` : "rule-new"} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface"><ChevronDown size={15} className={cn("transition-transform", isOpen && "rotate-180")} /></button>
    </div>
    {isOpen && draft && <div id={rule ? `rule-${encodeURIComponent(rule.spoken)}` : "rule-new"} role="region" aria-label={rule ? `Rule ${rule.spoken}` : "New rule"} className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3 px-3 pb-4 @max-[860px]/main:grid-cols-1">
      <div className="rounded-2xl bg-card p-4">
        <span className="label-meta mb-3 block text-[10px] text-faint">Rule</span>
        <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 @max-[560px]/main:grid-cols-1">
          <Input aria-label="When I say" value={draft.spoken} onChange={(event) => onDraftChange({ spoken: event.target.value })} placeholder="When I say" />
          <ArrowRight size={14} className="mx-auto text-faint" />
          <Input aria-label="Write" value={draft.written} onChange={(event) => onDraftChange({ written: event.target.value })} placeholder="Write" />
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted">{draft.spoken && draft.written ? `Say “${draft.spoken}” and Vaani writes “${draft.written}”, in every app.` : "Type what you say and how Vaani should write it."}</p>
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
      <div className="rounded-2xl bg-card p-4">
        <span className="label-meta mb-3 block text-[10px] text-faint">Matching</span>
        <MatchRow title="Whole word" note="Leaves “pay” in “payment” alone" checked={draft.wholeWord !== false} onChange={(checked) => onDraftChange({ wholeWord: checked })} />
        <MatchRow title="Case-sensitive" note="Only match this exact casing" checked={draft.caseSensitive === true} onChange={(checked) => onDraftChange({ caseSensitive: checked })} />
        <MatchRow title="Fuzzy match" note="Catches close mishearings" checked={draft.fuzzy === true} onChange={(checked) => onDraftChange({ fuzzy: checked })} />
        <div className="mt-3 border-t border-line pt-3"><span className="label-meta block text-[10px] text-faint">Source</span><Tag tone={rule?.source === "auto-suggested" ? "butter" : "sky"} className="mt-2">{rule?.source === "auto-suggested" ? "Auto" : "Manual"}</Tag><p className="mt-2 text-xs leading-relaxed text-muted">{rule?.source === "auto-suggested" ? "Suggested by Vaani." : rule ? "Added by you." : "You are adding this now."}</p>{rule && <p className="mt-2 text-xs text-muted">{hits} hits{lastUsed ? `. Last used ${lastUsed}.` : hits === 0 ? ". Not used yet." : "."}</p>}</div>
      </div>
      <div className="col-span-full flex items-center gap-2 @max-[860px]/main:col-span-1"><Button size="sm" onClick={onSave}>{rule ? "Save rule" : "Add rule"}</Button><Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><span className="flex-1" />{rule && <Button variant="danger" size="sm" onClick={onDelete}><Trash2 />Delete rule</Button>}</div>
    </div>}
  </article>;
}

// Renders a matching option and its short explanation.
function MatchRow({ title, note, checked, onChange }: { title: string; note: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-center gap-3 py-1 text-[13px] font-semibold text-ink"><span className="min-w-0 flex-1">{title}<small className="mt-0.5 block text-[11.5px] font-normal text-muted">{note}</small></span><Toggle checked={checked} onChange={onChange} aria-label={title} /></div>;
}
