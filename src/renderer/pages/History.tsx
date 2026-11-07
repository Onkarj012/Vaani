import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bug,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import type { DictationEntry, DictationTrace } from "@shared/types";
import { useVaaniUi } from "@renderer/context/vaani-ui";
import AppIcon from "@renderer/components/ui/AppIcon";
import { Button } from "@renderer/components/ui/button";
import { Tag } from "@renderer/components/ui/tag";
import FilterChips from "@renderer/components/ui/FilterChips";
import PageHeader from "@renderer/components/ui/PageHeader";
import { Segmented } from "@renderer/components/ui/Segmented";
import { Textarea } from "@renderer/components/ui/input";
import { formatHotkeyLabel } from "@renderer/components/HotkeyCapture";
import {
  buildProof,
  summarizeProof,
  type ProofToken,
} from "@renderer/lib/proofMarks";
import { historyTimeLabel, proofSummaryText } from "@renderer/lib/listRows";
import { cn } from "@renderer/lib/utils";

type HistoryFilter = "all" | "inserted" | "saved";
type DetailTab = "proof" | "cleaned" | "raw";

// Renders the expandable history list and its selected dictation details.
export default function History() {
  const {
    historyEntries,
    settings,
    updateHistoryEntry,
    deleteHistoryEntry,
    copyHistoryEntry,
  } = useVaaniUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const requestedEditId = searchParams.get("editEntryId");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("proof");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [traces, setTraces] = useState<
    Record<string, DictationTrace | null | "loading">
  >({});
  const processedEditId = useRef<string | null>(null);

  const entries = useMemo(
    () =>
      [...historyEntries].sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      ),
    [historyEntries],
  );
  const options = useMemo(
    () => ({
      fillers: [...settings.fillerWords, ...settings.extraFillerWords],
      corrections: settings.customCorrections,
    }),
    [
      settings.fillerWords,
      settings.extraFillerWords,
      settings.customCorrections,
    ],
  );
  // Proof summaries are costly, so they are worked out once per history or settings change, not on every keystroke.
  const lineSummaries = useMemo(
    () =>
      new Map(
        entries.map((entry) => [
          entry.id,
          proofSummaryText(summarizeProof(buildProof(entry.rawText, entry.cleanedText, options))),
        ]),
      ),
    [entries, options],
  );
  const visibleEntries = entries.filter((entry) => {
    const filterMatches =
      filter === "all" ||
      (filter === "inserted" ? entry.injectionStatus === "injected" : entry.injectionStatus === "saved");
    return (
      filterMatches &&
      (!query.trim() ||
        `${entry.cleanedText} ${entry.formattedText} ${entry.rawText} ${entry.appName ?? ""}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()))
    );
  });
  const selected = visibleEntries.find((entry) => entry.id === openId) ?? null;

  useEffect(() => {
    // Forget the last request once its param is gone, so the same entry can be opened again.
    if (!requestedEditId) {
      processedEditId.current = null;
      return;
    }
    if (processedEditId.current === requestedEditId) return;
    const entry = historyEntries.find((item) => item.id === requestedEditId);
    if (!entry) return;
    processedEditId.current = requestedEditId;
    setFilter("all");
    setOpenId(entry.id);
    setDraft(entry.cleanedText);
    setEditing(true);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("editEntryId");
        next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [requestedEditId, historyEntries, setSearchParams]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) {
        setEditing(false);
        setDraft(selected?.cleanedText ?? "");
        return;
      }
      if (openId) setOpenId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, openId, selected]);

  useEffect(() => {
    const traceId = selected?.traceId;
    if (!traceId || traces[traceId] !== undefined) return;
    setTraces((current) => ({ ...current, [traceId]: "loading" }));
    void window.vaani
      .getDictationTrace(traceId)
      .then((trace) =>
        setTraces((current) => ({ ...current, [traceId]: trace ?? null })),
      )
      .catch(() => setTraces((current) => ({ ...current, [traceId]: null })));
  }, [selected?.traceId, traces]);

  const setQuery = (value: string) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  const counts = {
    all: entries.length,
    inserted: entries.filter((entry) => entry.injectionStatus === "injected")
      .length,
    saved: entries.filter((entry) => entry.injectionStatus === "saved").length,
  };
  const close = () => {
    setOpenId(null);
    setEditing(false);
    setDraft("");
  };
  const saveEdit = () => {
    if (!selected) return;
    void updateHistoryEntry(selected.id, draft);
    setEditing(false);
  };
  const deleteEntry = () => {
    if (!selected) return;
    void deleteHistoryEntry(selected.id);
    close();
  };
  const exportReport = async (entry: DictationEntry) => {
    const report = await window.vaani.exportBugReport(entry.id);
    await window.vaani.copyText(JSON.stringify(report, null, 2));
  };
  const proof = selected
    ? buildProof(selected.rawText, selected.cleanedText, options)
    : [];
  const summary = summarizeProof(proof);
  const trace = selected?.traceId ? traces[selected.traceId] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="Kept on this Mac"
        title="History"
        subtitle="Everything you dictated, with what Vaani changed."
      />
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <label className="flex h-10 w-[340px] max-w-full items-center gap-[9px] rounded-full bg-surface px-[15px] text-muted">
          <SearchFieldInput value={query} onChange={setQuery} />
        </label>
        <FilterChips
          value={filter}
          onChange={(value) => setFilter(value as HistoryFilter)}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "inserted", label: "Inserted", count: counts.inserted },
            { value: "saved", label: "Saved", count: counts.saved },
          ]}
        />
      </div>
      <section
        aria-label="Dictations"
        className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-card p-1.5"
      >
        {visibleEntries.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted">
            {entries.length
              ? "No dictations match."
              : `No dictations yet. ${settings.dictationMode === "toggle" ? "Press" : "Hold"} ${formatHotkeyLabel(settings.primaryHotkey)} anywhere to start.`}
          </p>
        ) : (
          visibleEntries.map((entry) => {
            const isOpen = entry.id === openId;
            const app = entry.appName?.trim() || "Unknown app";
            const time = historyTimeLabel(entry.timestamp);
            const lineSummary = lineSummaries.get(entry.id) ?? "";
            return (
              <article
                key={entry.id}
                className={cn("rounded-[18px]", isOpen && "bg-surface")}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`history-${entry.id}`}
                  onClick={() => {
                    if (isOpen) close();
                    else {
                      setOpenId(entry.id);
                      setDraft(entry.cleanedText);
                      setEditing(false);
                      setDetailTab("proof");
                    }
                  }}
                  className={cn(
                    "grid w-full grid-cols-[30px_minmax(0,1fr)_auto_136px_16px] items-center gap-3.5 rounded-[18px] px-3.5 py-[11px] text-left hover:bg-surface @max-[720px]/main:grid-cols-[30px_minmax(0,1fr)_auto_16px] @max-[720px]/main:[&_.history-time]:hidden",
                    isOpen && "hover:bg-transparent",
                  )}
                >
                  <AppIcon name={app} bundleId={entry.appBundleId} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {entry.cleanedText.split("\n")[0] || "Empty dictation"}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted">
                      {app} ·{" "}
                      {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {lineSummary && (
                        <>
                          {" "}
                          · <span className="text-accent">✎ {lineSummary}</span>
                        </>
                      )}
                    </span>
                  </span>
                  {entry.injectionStatus === "saved" ? (
                    <Tag tone="butter">Saved</Tag>
                  ) : (
                    <span />
                  )}
                  <span className="history-time whitespace-nowrap text-right text-xs text-muted">
                    {time}
                  </span>
                  <ChevronDown
                    size={15}
                    className={cn(
                      "text-faint transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <div
                    id={`history-${entry.id}`}
                    role="region"
                    aria-label={`${app} dictation, ${time}`}
                    className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 px-4 pb-5 pl-[58px] @max-[860px]/main:grid-cols-1 @max-[720px]/main:pl-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <Segmented
                          value={detailTab}
                          onChange={(value) => setDetailTab(value as DetailTab)}
                          options={[
                            { value: "proof", label: "Proof" },
                            {
                              value: "cleaned",
                              label: "Cleaned",
                            },
                            { value: "raw", label: "Raw" },
                          ]}
                        />
                        <span className="label-meta text-[10px] text-faint">
                          {detailTab === "proof"
                            ? "What Vaani changed"
                            : detailTab === "raw"
                              ? "Before cleanup"
                              : "What was typed"}
                        </span>
                      </div>
                      {editing ? (
                        <div className="mt-3 rounded-[18px] border border-line bg-card p-4">
                          <Textarea
                            aria-label="Edit dictation text"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            rows={5}
                            className="resize-y"
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(false);
                                setDraft(entry.cleanedText);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button size="sm" onClick={saveEdit}>
                              <Check />
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="my-3 rounded-[20px] border border-line bg-card p-5">
                          <div
                            className={cn(
                              "min-h-[54px] whitespace-pre-line text-[16.5px] leading-[1.7] text-ink",
                              detailTab === "raw" &&
                                "font-mono text-sm text-muted",
                            )}
                          >
                            {detailTab === "raw" ? (
                              entry.rawText
                            ) : detailTab === "cleaned" ? (
                              entry.cleanedText
                            ) : (
                              <ProofText tokens={proof} />
                            )}
                          </div>
                          {detailTab === "proof" && (
                            <ProofLegend summary={summary} />
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            void copyHistoryEntry(entry.cleanedText)
                          }
                        >
                          <Copy />
                          Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          disabled={editing}
                          onClick={() => {
                            setDraft(entry.cleanedText);
                            setEditing(true);
                          }}
                        >
                          <Pencil />
                          Edit
                        </Button>
                        <span className="flex-1" />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void exportReport(entry)}
                        >
                          <Bug />
                          Export bug report
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label="Delete dictation"
                          onClick={deleteEntry}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="label-meta text-[10px] text-faint">
                        Diagnostics
                      </p>
                      <Diagnostics
                        entry={entry}
                        trace={trace === "loading" ? undefined : trace}
                      />
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

// Renders the history search input that the toolbar shortcut focuses.
function SearchFieldInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <Search size={16} aria-hidden="true" />
      <input
        data-history-search
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search what you said…"
        className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
      />
      <kbd className="pointer-events-none rounded-[7px] border border-line bg-card px-1.5 py-1 text-[11px] font-semibold text-ink">
        ⌘K
      </kbd>
    </>
  );
}

// Renders proof tokens with the prototype's change marks.
function ProofText({ tokens }: { tokens: ProofToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === "break") return <br key={index} />;
        if (token.kind === "filler" || token.kind === "scratched")
          return (
            <Fragment key={index}>
              <s className="text-[#c2412d] decoration-[#c2412d] dark:text-[#f0907c] dark:decoration-[#f0907c]">
                {token.text}
              </s>{" "}
            </Fragment>
          );
        if (token.kind === "command")
          return (
            <span
              key={index}
              className="mx-1 rounded-md bg-blush px-1.5 py-0.5 font-mono text-[11px] text-[#7a2d66]"
            >
              ⌫ {token.text}
            </span>
          );
        if (token.kind === "fix")
          return (
            <Fragment key={index}>
              <span
                className={cn(
                  "rounded-md px-1 py-0.5 text-[#1d1d1d]",
                  token.dictionary ? "bg-sky" : "bg-butter",
                )}
              >
                <s className="mr-1 font-mono text-[11px] text-[#45515f]">
                  {token.from}
                </s>
                {token.to}
              </span>{" "}
            </Fragment>
          );
        if (token.kind === "added")
          return (
            <Fragment key={index}>
              <span className="rounded-md bg-butter px-1 text-[#1d1d1d]">
                {token.text}
              </span>{" "}
            </Fragment>
          );
        if (token.kind === "removed")
          return (
            <Fragment key={index}>
              <s className="text-muted">{token.text}</s>{" "}
            </Fragment>
          );
        return <span key={index}>{token.text} </span>;
      })}
    </>
  );
}

// Renders the proof legend from the changes found in the transcript.
function ProofLegend({
  summary,
}: {
  summary: ReturnType<typeof summarizeProof>;
}) {
  const labels = [
    summary.fillers > 0 &&
      `${summary.fillers} filler${summary.fillers === 1 ? "" : "s"} removed`,
    summary.scratched > 0 && "Scratched with ‘scratch that’",
    summary.dictionaryFixes > 0 &&
      `${summary.dictionaryFixes} dictionary fix${summary.dictionaryFixes === 1 ? "" : "es"}`,
    summary.rewrites > 0 &&
      `${summary.rewrites} text fix${summary.rewrites === 1 ? "" : "es"}`,
  ].filter((label): label is string => Boolean(label));
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-dashed border-line pt-3 text-xs text-muted">
      {labels.length ? (
        labels.map((label) => <span key={label}>{label}</span>)
      ) : (
        <span>Vaani only added punctuation and capitals</span>
      )}
    </div>
  );
}

// Shows diagnostics only when the trace contains the corresponding data.
function Diagnostics({
  entry,
  trace,
}: {
  entry: DictationEntry;
  trace: DictationTrace | null | undefined;
}) {
  const cells: { label: string; value?: string; detail?: string }[] = [
    {
      label: "Outcome",
      value:
        trace?.outcome ??
        (entry.injectionStatus === "saved" ? "Saved to History" : "Inserted"),
    },
    {
      label: "Target",
      value: trace?.targetAppName ?? entry.appName ?? undefined,
      detail: insertMethodLabel(trace?.injectionMethod ?? entry.injectionMethod ?? undefined),
    },
    {
      label: "Speech to text",
      value: trace?.sttProvider ?? undefined,
      detail:
        trace?.sttLatencyMs === undefined
          ? undefined
          : `${trace.sttLatencyMs} ms`,
    },
    {
      label: "Cleanup",
      value: trace?.stages?.formatterUsed ?? undefined,
      detail:
        trace?.formattingLatencyMs === undefined
          ? undefined
          : `${trace.formattingLatencyMs} ms`,
    },
    {
      label: "Quality / reason",
      value: trace?.qualityDecision?.action ?? undefined,
      detail:
        trace?.qualityDecision?.reason ?? trace?.rejectionReason ?? undefined,
    },
  ];
  const shown = cells.filter((cell) => cell.value || cell.detail);
  return shown.length ? (
    <div className="mt-2 grid grid-cols-2 gap-2 @max-[720px]/main:grid-cols-1">
      {shown.map((cell) => (
        <div key={cell.label} className="min-w-0 rounded-[14px] bg-card p-3">
          <span className="block text-xs text-muted">{cell.label}</span>
          {cell.value && (
            <b className="mt-1 block break-words text-[13px] font-semibold text-ink">
              {cell.value}
            </b>
          )}
          {cell.detail && (
            <small className="mt-0.5 block break-words text-xs text-muted">
              {cell.detail}
            </small>
          )}
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-2 rounded-[14px] bg-card p-3 text-sm text-muted">
      No diagnostics were recorded.
    </p>
  );
}

// Names the insertion method the way Settings does.
function insertMethodLabel(method: string | undefined): string | undefined {
  if (method === "ax") return "Accessibility API";
  if (method === "clipboard") return "Clipboard paste";
  return method;
}
