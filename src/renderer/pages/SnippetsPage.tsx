import { useState } from "react";
import { useVaaniUi } from "@/context/vaani-ui";
import { PageLayout } from "./components/PageLayout";
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

const colHeaders = ["#", "Command", "Expansion", "Actions"];
const gridCols = "40px 160px 1fr 100px";

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

const inputStyle: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 16,
  color: "var(--text)",
  background: "var(--bg)",
  border: "1px solid var(--border-light)",
  padding: "8px 12px",
  outline: "none",
  borderRadius: 0,
  width: "100%",
};

export default function SnippetsPage() {
  const { snippets, addSnippet, removeSnippet } = useVaaniUi();
  const [showAdd, setShowAdd] = useState(false);
  const [trigger, setTrigger] = useState("");
  const [content, setContent] = useState("");

  const handleAdd = async () => {
    if (!trigger.trim()) return;
    await addSnippet({ trigger: trigger.trim(), content: content.trim() });
    setTrigger("");
    setContent("");
    setShowAdd(false);
  };

  const addAction = (
    <button onClick={() => setShowAdd((s) => !s)} style={btnStyle(true)}>
      {showAdd ? "Cancel" : "+ New Snippet"}
    </button>
  );

  return (
    <PageLayout
      title={`${snippets.length} Snippets`}
      breadcrumb="Vaani / Snippets"
      action={addAction}
      noPad
    >
      {/* Add form */}
      {showAdd && (
        <div
          style={{
            padding: "24px 48px",
            borderBottom: "2px solid var(--accent)",
            background: "var(--bg-2)",
          }}
        >
          <p style={{ ...label, color: "var(--accent)", marginBottom: 16 }}>New Snippet</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, marginBottom: 16 }}>
            <div>
              <p style={{ ...label, marginBottom: 8 }}>Trigger (say "slash ...")</p>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 16,
                    color: "var(--accent)",
                    background: "var(--bg-3)",
                    border: "1px solid var(--border-light)",
                    borderRight: "none",
                    padding: "8px 10px",
                    flexShrink: 0,
                  }}
                >
                  /
                </span>
                <input
                  type="text"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  placeholder="address"
                  style={{ ...inputStyle, borderLeft: "none" }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; }}
                  onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--border-light)"; }}
                />
              </div>
            </div>
            <div>
              <p style={{ ...label, marginBottom: 8 }}>Expansion</p>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="e.g. 123 Main St, Springfield"
                style={inputStyle}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--border-light)"; }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAdd} style={btnStyle(true)}>Save Snippet</button>
            <button onClick={() => setShowAdd(false)} style={btnStyle(false)}>Cancel</button>
          </div>
        </div>
      )}

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
      {snippets.length === 0 ? (
        <p
          style={{
            padding: "48px",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 16,
            color: "var(--text-muted)",
          }}
        >
          No snippets yet. Create slash-command shortcuts like /address or /sig.
        </p>
      ) : (
        snippets.map((item, i) => (
          <div
            key={item.trigger}
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              padding: "15px 48px",
              borderBottom: "1px solid var(--border-light)",
              alignItems: "center",
              gap: 16,
              transition: "background 0.1s",
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

            <code
              style={{
               fontFamily: "monospace",
               fontSize: 11,
               color: "var(--accent)",
                background: "var(--bg-3)",
                border: "1px solid var(--border-light)",
                padding: "3px 8px",
                display: "inline-block",
              }}
            >
              /{item.trigger}
            </code>

            <p
              style={{
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                fontSize: 16,
                color: "var(--text)",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.content}
            </p>

            <div>
              <button
                onClick={() => void removeSnippet(item.trigger)}
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
        ))
      )}
    </PageLayout>
  );
}
