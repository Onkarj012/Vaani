import React, { useState, useCallback } from "react";
import { useVaaniUi } from "@/context/vaani-ui";
import { PageLayout } from "./components/PageLayout";
import { HotkeyCapture } from "@/components/HotkeyCapture";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ApiKeyInput } from "@/components/ui/api-key-input";
import { useTheme } from "next-themes";
import type { CSSProperties } from "react";

const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "en",   label: "English" },
  { value: "hi",   label: "हिंदी" },
  { value: "hinglish", label: "Hinglish" },
  { value: "ta",   label: "தமிழ்" },
  { value: "pa",   label: "ਪੰਜਾਬੀ" },
];

const INJECTION_MODES = [
  { value: "auto",      label: "Auto (recommended)" },
  { value: "ax",        label: "Accessibility API" },
  { value: "clipboard", label: "Clipboard" },
];

const ACCENT_PRESETS: { color: string; name: string }[] = [
  { color: "#7C3AED", name: "Violet" },
  { color: "#4F46E5", name: "Indigo" },
  { color: "#2563EB", name: "Blue" },
  { color: "#0891B2", name: "Cyan" },
  { color: "#059669", name: "Emerald" },
  { color: "#D97706", name: "Amber" },
  { color: "#E11D48", name: "Rose" },
  { color: "#64748B", name: "Slate" },
];

/* ── Primitive components ── */

const sectionLabel: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: 0,
};

function SectionHeader({ letter, title }: { letter: string; title: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 48px",
        borderBottom: "1px solid var(--border-light)",
        background: "var(--bg-3)",
      }}
    >
      <div style={{ width: 3, height: 14, background: "var(--accent)", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--accent)",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            minWidth: 14,
          }}
        >
          {letter}
        </span>
      <span style={sectionLabel}>{title}</span>
    </div>
  );
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 24,
        padding: "16px 48px",
        borderBottom: "1px solid var(--border-light)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 16,
            color: "var(--text)",
            margin: 0,
            fontWeight: 500,
          }}
        >
          {label}
        </p>
        {desc && (
          <p
            style={{
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 3,
            }}
          >
            {desc}
          </p>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex" }}>
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "5px 14px",
            cursor: "pointer",
            borderRadius: 0,
            outline: "none",
            transition: "all 0.1s",
            border: `1px solid ${value === v ? "var(--accent)" : "var(--border-light)"}`,
            background: value === v ? "var(--accent)" : "transparent",
            color: value === v ? "#fff" : "var(--text-sub)",
            marginLeft: -1,
            zIndex: value === v ? 1 : 0,
            position: "relative",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RangeRow({
  label,
  desc,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  desc?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} desc={desc}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Slider
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={([v]) => onChange(v ?? value)}
          className="w-40"
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "var(--text-muted)",
            width: 44,
            textAlign: "right",
          }}
        >
          {display}
        </span>
      </div>
    </Row>
  );
}

const actionBtn = (destructive = false): CSSProperties => ({
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  border: `1px solid ${destructive ? "var(--destructive, #E11D48)" : "var(--border-light)"}`,
  background: "transparent",
  color: destructive ? "var(--destructive, #E11D48)" : "var(--text-sub)",
  padding: "6px 14px",
  cursor: "pointer",
  borderRadius: 0,
  outline: "none",
  transition: "all 0.1s",
});

/* ── Page ── */

export default function SettingsPage() {
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries } = useVaaniUi();
  const { setTheme } = useTheme();
  const [exporting, setExporting] = useState(false);
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [hexInput, setHexInput] = useState(settings.accentColor || "#7C3AED");

  const currentAccent  = settings.accentColor || "#7C3AED";
  const capsuleDesign  = settings.capsuleDesign || "bar";

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const exportData = { exportedAt: new Date().toISOString(), settings, history: historyEntries };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vaani-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [settings, historyEntries]);

  return (
    <PageLayout title="Settings" breadcrumb="Vaani / Settings" noPad>

      {/* A — API & Transcription */}
      <SectionHeader letter="A" title="API & Transcription" />

      <Row label="Groq API Key" desc="Whisper transcription via Groq">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ApiKeyInput
            value={settings.groqApiKey}
            onChange={(e) => void updateSettings({ groqApiKey: e.target.value })}
            placeholder="gsk_..."
            readOnly={!editingApiKey && !!settings.groqApiKey}
            autoFocus={editingApiKey}
          />
          {!editingApiKey ? (
            <button
              type="button"
              onClick={() => { setEditingApiKey(true); void updateSettings({ groqApiKey: "" }); }}
              style={{ ...actionBtn(false), fontSize: 11 }}
            >
              Replace
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditingApiKey(false)}
              style={{
                ...actionBtn(false),
                borderColor: "var(--accent)",
                color: "var(--accent)",
              }}
            >
              Done
            </button>
          )}
        </div>
      </Row>

      <Row label="Language" desc="Primary transcription language">
        <Select
          value={settings.language}
          onChange={(v) => void updateSettings({ language: v })}
          options={LANGUAGES}
        />
      </Row>

      <Row label="Text Cleanup" desc="Remove filler words, auto-capitalize">
        <Switch
          checked={settings.cleanupEnabled}
          onCheckedChange={(v) => void updateSettings({ cleanupEnabled: v })}
        />
      </Row>

      <Row label="Smart Punctuation" desc="Auto-insert commas, periods, em-dashes">
        <Switch
          checked={settings.smartPunctuation}
          onCheckedChange={(v) => void updateSettings({ smartPunctuation: v })}
        />
      </Row>

      {/* B — Keyboard */}
      <SectionHeader letter="B" title="Keyboard" />

      <Row label="Global Trigger Hotkey" desc="Activate the HUD from anywhere">
        <HotkeyCapture value={settings.primaryHotkey} onChange={(human) => void updateSettings({ primaryHotkey: human })} />
      </Row>

      <Row label="Paste Last Entry" desc="Re-inject most recent transcription">
        <HotkeyCapture value={settings.pasteLatestHotkey} onChange={(human) => void updateSettings({ pasteLatestHotkey: human })} />
      </Row>

      <Row label="Cancel Recording">
        <kbd
          style={{
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "3px 8px",
            border: "2px solid var(--border)",
            background: "var(--bg-2)",
            color: "var(--text)",
            borderRadius: 0,
          }}
        >
          Esc
        </kbd>
      </Row>

      {/* C — Injection */}
      <SectionHeader letter="C" title="Text Injection" />

      <Row label="Injection Mode" desc="How text is inserted into apps">
        <Select
          value={settings.injectionMode}
          onChange={(v) => void updateSettings({ injectionMode: v as "auto" | "ax" | "clipboard" })}
          options={INJECTION_MODES}
        />
      </Row>

      <Row label="Paste Mode" desc="How text appears after injection">
        <Segment
          value={settings.pasteMode}
          options={[
            { value: "instant", label: "Instant" },
            { value: "animated", label: "Typewriter" },
          ]}
          onChange={(v) => void updateSettings({ pasteMode: v })}
        />
      </Row>

      {/* D — Capsule Style */}
      <SectionHeader letter="D" title="Capsule Style" />

      {/* Design picker */}
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "20px 48px",
          borderBottom: "1px solid var(--border-light)",
        }}
      >
        {(["pill", "bar", "dot", "rule"] as const).map((design) => {
          const selected = capsuleDesign === design;
          const label = design === "pill" ? "Pill" : design === "bar" ? "Bar" : design === "dot" ? "Dot" : "Rule";
          return (
            <div
              key={design}
              onClick={() => void updateSettings({ capsuleDesign: design })}
              style={{
                width: 80,
                cursor: "pointer",
                border: `2px solid ${selected ? "var(--accent)" : "var(--border-light)"}`,
                padding: "12px 8px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                transition: "border-color 0.1s",
              }}
            >
              {design === "pill" && (
                <div
                  style={{
                    width: 64,
                    height: 22,
                    border: `2px solid var(--accent)`,
                    borderRadius: 11,
                    display: "flex",
                    alignItems: "stretch",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      borderRight: `2px solid var(--accent)`,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      padding: "0 4px",
                    }}
                  >
                    {[0.4, 0.8, 0.6, 1, 0.7, 0.5].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          width: 2,
                          height: Math.round(h * 12),
                          background: "var(--accent)",
                          borderRadius: 1,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {design === "bar" && (
                <div
                  style={{
                    width: 64,
                    height: 20,
                    border: `2px solid var(--accent)`,
                    display: "flex",
                    alignItems: "stretch",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      borderRight: `2px solid var(--accent)`,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      padding: "0 4px",
                    }}
                  >
                    {[0.4, 0.8, 0.6, 1, 0.7, 0.5].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          width: 2,
                          height: Math.round(h * 12),
                          background: "var(--accent)",
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {design === "dot" && (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    border: `2px solid var(--accent)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              )}
              {design === "rule" && (
                <div
                  style={{
                    width: 64,
                    height: 10,
                    border: `2px solid var(--accent)`,
                  }}
                />
              )}
              <span
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  color: selected ? "var(--accent)" : "var(--text-muted)",
                  transition: "color 0.1s",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>


      {/* E — Appearance */}
      <SectionHeader letter="E" title="Appearance" />

      <Row label="Color Mode" desc="Light or dark interface">
        <Segment
          value={settings.colorMode as "light" | "dark"}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(v) => {
            setTheme(v);
            void updateSettings({ colorMode: v });
          }}
        />
      </Row>

      {/* Accent color — full-width block */}
      <div
        style={{
          padding: "20px 48px",
          borderBottom: "1px solid var(--border-light)",
        }}
      >
        <p style={{ ...sectionLabel, marginBottom: 16 }}>Accent Color</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {ACCENT_PRESETS.map(({ color, name }) => {
            const active = currentAccent.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={color}
                title={name}
                onClick={() => {
                  void updateSettings({ accentColor: color });
                  setHexInput(color);
                }}
                style={{
                  width: 26,
                  height: 26,
                  background: color,
                  border: active ? `3px solid var(--text)` : "3px solid transparent",
                  outline: active ? `2px solid ${color}` : "none",
                  outlineOffset: 2,
                  cursor: "pointer",
                  borderRadius: 0,
                  transition: "all 0.1s",
                  transform: active ? "scale(1.15)" : "scale(1)",
                }}
              />
            );
          })}

          {/* Divider + hex input */}
          <div
            style={{
              width: 1,
              height: 26,
              background: "var(--border-light)",
              marginLeft: 4,
              marginRight: 4,
            }}
          />
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 18,
                height: 18,
                background: currentAccent,
                border: "1px solid var(--border-light)",
                flexShrink: 0,
                marginRight: 8,
              }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => {
                const val = e.target.value;
                setHexInput(val);
                if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                  void updateSettings({ accentColor: val });
                }
              }}
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                color: "var(--text)",
                background: "var(--bg)",
                border: "1px solid var(--border-light)",
                padding: "4px 8px",
                width: 88,
                outline: "none",
                borderRadius: 0,
              }}
              placeholder="#7C3AED"
              maxLength={7}
              spellCheck={false}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--border-light)"; }}
            />
          </div>
        </div>
      </div>

      {/* F — System */}
      <SectionHeader letter="F" title="System" />

      <Row label="Launch at Login">
        <Switch
          checked={settings.launchAtLogin}
          onCheckedChange={(v) => void updateSettings({ launchAtLogin: v })}
        />
      </Row>

      <Row label="Show in Dock">
        <Switch
          checked={settings.showInDock}
          onCheckedChange={(v) => void updateSettings({ showInDock: v })}
        />
      </Row>

      {/* G — Audio */}
      <SectionHeader letter="G" title="Audio" />

      <RangeRow
        label="Silence Threshold"
        desc="Sensitivity for silence detection"
        min={1} max={100} step={1}
        value={Math.round((settings.silenceThreshold || 0.01) * 10000)}
        display={String(Math.round((settings.silenceThreshold || 0.01) * 10000))}
        onChange={(v) => void updateSettings({ silenceThreshold: v / 10000 })}
      />

      <RangeRow
        label="Min Clip Duration"
        desc="Minimum recording length"
        min={1} max={50} step={1}
        value={Math.round((settings.minClipDuration || 0.5) * 10)}
        display={`${(settings.minClipDuration || 0.5).toFixed(1)}s`}
        onChange={(v) => void updateSettings({ minClipDuration: v / 10 })}
      />

      {/* H — Data */}
      <SectionHeader letter="H" title="Data" />

      <div
        style={{
          padding: "20px 48px",
          borderBottom: "1px solid var(--border-light)",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button onClick={handleExport} disabled={exporting} style={actionBtn(false)}>
          {exporting ? "Exporting…" : "Export Data"}
        </button>
        <button
          onClick={() => { if (confirm("Delete all history?")) void clearHistory(); }}
          style={actionBtn(true)}
        >
          Clear History
        </button>
        <button onClick={() => void resetSettings()} style={actionBtn(false)}>
          Reset Defaults
        </button>
      </div>

    </PageLayout>
  );
}
