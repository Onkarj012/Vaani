import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useVaaniUi } from "@/context/vaani-ui";
import { PageLayout } from "./components/PageLayout";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import type { HistoryItemView } from "@/context/vaani-ui";
import type { CSSProperties } from "react";

const label: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: 0,
};

const colHeaders = ["#", "Dictation", "Words", "Duration", "Actions"];
const gridCols = "40px 1fr 80px 80px 156px";

function groupByDate(items: HistoryItemView[]): Array<{ group: string; items: HistoryItemView[] }> {
  const map = new Map<string, HistoryItemView[]>();
  for (const item of items) {
    const arr = map.get(item.group) ?? [];
    arr.push(item);
    map.set(item.group, arr);
  }
  const order = ["Today", "Yesterday", "This Week", "Earlier"];
  const result: Array<{ group: string; items: HistoryItemView[] }> = [];
  for (const key of order) {
    const g = map.get(key);
    if (g) result.push({ group: key, items: g });
  }
  for (const [key, g] of map) {
    if (!order.includes(key)) result.push({ group: key, items: g });
  }
  return result;
}

export default function HistoryPage() {
  const {
    historyItems,
    copyHistoryEntry,
    deleteHistoryEntry,
    reinjectHistoryEntry,
    updateHistoryEntry,
    addDictionaryWord,
  } = useVaaniUi();

  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(
    () => historyItems.filter((e) => e.text.toLowerCase().includes(query.toLowerCase())),
    [historyItems, query],
  );
  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const startEditing = (item: { id: string; text: string }) => {
    setEditingId(item.id);
    setEditText(item.text);
    setOriginalText(item.text);
  };

  useEffect(() => {
    const id = searchParams.get("editEntryId");
    if (!id || editingId === id) return;
    const item = historyItems.find((e) => e.id === id);
    if (!item) return;
    startEditing(item);
    requestAnimationFrame(() => {
      document.getElementById(`he-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const p = new URLSearchParams(searchParams);
    p.delete("editEntryId");
    setSearchParams(p, { replace: true });
  }, [editingId, historyItems, searchParams, setSearchParams]);

  const saveEdit = async () => {
    if (!editingId) return;
    if (editText !== originalText) {
      const s = detectDictionarySuggestions(originalText, editText);
      if (s.length > 0) await window.vaani.showDictionaryPrompt(s);
    }
    await updateHistoryEntry(editingId, editText);
    setEditingId(null);
  };

  const handleCopy = (id: string, text: string) => {
    void copyHistoryEntry(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const btnStyle = (primary = false): CSSProperties => ({
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
    border: `1px solid ${primary ? "var(--accent)" : "var(--border-light)"}`,
    background: primary ? "var(--accent)" : "transparent",
    color: primary ? "#fff" : "var(--text-sub)",
    padding: "4px 9px",
    cursor: "pointer",
    borderRadius: 0,
    outline: "none",
    transition: "all 0.1s",
  });

  return (
    <PageLayout
      title={`${historyItems.length} Dictations`}
      breadcrumb="Vaani / History"
      noPad
    >
      {/* Search bar */}
      <div style={{ borderBottom: "1px solid var(--border-light)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span
            style={{
              ...label,
              color: "var(--accent)",
              padding: "16px 24px",
              borderRight: "1px solid var(--border-light)",
              minWidth: 80,
            }}
          >
            Search
          </span>
          <input
            type="text"
            placeholder="Filter dictations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              padding: "16px 24px",
              fontSize: 16,
              color: "var(--text)",
              outline: "none",
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontWeight: 400,
            }}
          />
          {query && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                padding: "0 20px",
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              }}
            >
              {filtered.length} results
            </span>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          padding: "10px 48px",
          borderBottom: "1px solid var(--border-light)",
          background: "var(--bg-2)",
          gap: 16,
        }}
      >
        {colHeaders.map((h) => (
          <span key={h} style={label}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      {grouped.map(({ group, items }) => (
        <div key={group}>
          {/* Date group header */}
          <div
            style={{
              padding: "8px 48px",
              background: "var(--bg-3)",
              borderBottom: "1px solid var(--border-light)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ width: 3, height: 14, background: "var(--accent)" }} />
            <span style={label}>{group}</span>
          </div>

          {items.map((item, i) => (
            <div key={item.id} id={`he-${item.id}`}>
              {editingId === item.id ? (
                <div
                  style={{
                    padding: "16px 48px",
                    borderBottom: "1px solid var(--border-light)",
                    background: "var(--bg-2)",
                  }}
                >
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                    style={{
                      width: "100%",
                      border: "2px solid var(--accent)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      padding: "10px 14px",
                      fontSize: 16,
                      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                      outline: "none",
                      borderRadius: 0,
                      minHeight: 80,
                      resize: "vertical",
                      marginBottom: 10,
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={saveEdit} style={btnStyle(true)}>Save</button>
                    {editText !== originalText && (
                      <button
                        style={btnStyle(false)}
                        onClick={async () => {
                          const s = detectDictionarySuggestions(originalText, editText);
                          for (const sug of s) await addDictionaryWord({ word: sug.spoken, replacement: sug.written });
                          await saveEdit();
                        }}
                      >
                        + Dictionary
                      </button>
                    )}
                    <button onClick={() => setEditingId(null)} style={btnStyle(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    padding: "15px 48px",
                    borderBottom: "1px solid var(--border-light)",
                    alignItems: "start",
                    gap: 16,
                    transition: "background 0.1s",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span
                    style={{
                       fontSize: 11,
                       fontWeight: 700,
                       color: "var(--accent)",
                      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  <p
                    style={{
                      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                      fontSize: 16,
                      color: "var(--text)",
                      lineHeight: 1.55,
                      margin: 0,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {item.text}
                  </p>

                  <span
                    style={{
                      fontSize: 16,
                      color: "var(--text-sub)",
                      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                    }}
                  >
                    {item.wordCount}
                  </span>

                  <span
                    style={{
                      fontSize: 16,
                      color: "var(--text-sub)",
                      fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                    }}
                  >
                    {item.duration}
                  </span>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      onClick={() => handleCopy(item.id, item.text)}
                      style={{
                        ...btnStyle(false),
                        color: copied === item.id ? "var(--accent)" : "var(--text-sub)",
                      }}
                    >
                      {copied === item.id ? "Copied" : "Copy"}
                    </button>
                    <button onClick={() => startEditing(item)} style={btnStyle(false)}>Edit</button>
                    <button
                      onClick={() => void reinjectHistoryEntry(item.id)}
                      style={btnStyle(false)}
                    >
                      Re-use
                    </button>
                    <button
                      onClick={() => void deleteHistoryEntry(item.id)}
                      style={{ ...btnStyle(false), color: "var(--text-muted)", borderColor: "transparent" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.color = "var(--destructive)";
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--destructive)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                        (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                      }}
                    >
                      Del
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {historyItems.length === 0 && (
        <p
          style={{
            padding: "48px",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 16,
            color: "var(--text-muted)",
          }}
        >
          No history yet. Start dictating to see your transcriptions here.
        </p>
      )}
    </PageLayout>
  );
}
