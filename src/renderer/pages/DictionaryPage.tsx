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

const colHeaders = ["#", "Spoken (trigger)", "Written (replacement)", "Actions"];
const gridCols = "40px 1fr 1fr 120px";

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

export default function DictionaryPage() {
  const { dictionaryItems, addDictionaryWord, removeDictionaryWord } = useVaaniUi();
  const [showAdd, setShowAdd] = useState(false);
  const [word, setWord] = useState("");
  const [replacement, setReplacement] = useState("");

  const handleAdd = async () => {
    if (!word.trim()) return;
    await addDictionaryWord({ word: word.trim(), replacement: replacement.trim() || word.trim() });
    setWord("");
    setReplacement("");
    setShowAdd(false);
  };

  const addAction = (
    <button
      onClick={() => setShowAdd((s) => !s)}
      style={btnStyle(true)}
    >
      {showAdd ? "Cancel" : "+ Add Rule"}
    </button>
  );

  return (
    <PageLayout
      title={`${dictionaryItems.length} Rules`}
      breadcrumb="Vaani / Dictionary"
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
          <p style={{ ...label, color: "var(--accent)", marginBottom: 16 }}>New Rule</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <p style={{ ...label, marginBottom: 8 }}>When I say...</p>
              <input
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="e.g. vaani"
                style={inputStyle}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--border-light)"; }}
              />
            </div>
            <div>
              <p style={{ ...label, marginBottom: 8 }}>Replace with...</p>
              <input
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="e.g. Vaani"
                style={inputStyle}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--border-light)"; }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAdd} style={btnStyle(true)}>Add to Dictionary</button>
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
      {dictionaryItems.length === 0 ? (
        <p
          style={{
            padding: "48px",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 16,
            color: "var(--text-muted)",
          }}
        >
          No rules yet. Add brand names, software names, or corrections to improve accuracy.
        </p>
      ) : (
        dictionaryItems.map((item, i) => (
          <div
            key={item.word}
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
              {item.word}
            </code>

            <span
              style={{
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                fontSize: 16,
                color: "var(--text)",
              }}
            >
              {item.replacement || item.word}
            </span>

            <div>
              <button
                onClick={() => void removeDictionaryWord(item.word)}
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
