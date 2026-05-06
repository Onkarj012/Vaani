import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd, KbdGroup } from "@/components/ui/Kbd";

interface HotkeyCaptureProps {
  value:    string;
  onChange: (human: string) => void;
  disabled?: boolean;
}

const MOD_SYMBOL: Record<string, string> = {
  Cmd: "⌘", Ctrl: "⌃", Option: "⌥", Shift: "⇧",
  Command: "⌘", Alt: "⌥", Control: "⌃", Fn: "Fn",
};

function keyToLabel(key: string): string {
  const map: Record<string, string> = {
    " ": "Space", "ArrowUp": "↑", "ArrowDown": "↓",
    "ArrowLeft": "←", "ArrowRight": "→",
    "Enter": "Return", "Escape": "Esc", "Tab": "Tab",
    "Backspace": "⌫", "Delete": "⌦",
    "Meta": "Cmd", "Control": "Ctrl", "Alt": "Option", "Shift": "Shift",
  };
  return map[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

function parseCombo(combo: string): string[] {
  return combo.split("+").filter(Boolean);
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

export function HotkeyCapture({ value, onChange, disabled }: HotkeyCaptureProps) {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const lastModifierRef = useRef<string | null>(null);

  const stopCapture = useCallback(() => {
    void window.vaani.setHotkeyCapture(false);
    setCapturing(false);
    setPreview([]);
    lastModifierRef.current = null;
  }, []);

  const beginCapture = useCallback(() => {
    if (disabled) return;
    void window.vaani.setHotkeyCapture(true);
    setPreview([]);
    setCapturing(true);
    lastModifierRef.current = null;
    requestAnimationFrame(() => { btnRef.current?.focus(); });
  }, [disabled]);

  useEffect(() => () => { void window.vaani.setHotkeyCapture(false); }, []);

  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stopCapture(); return; }

      const mods: string[] = [];
      if (e.metaKey)  mods.push("Cmd");
      if (e.ctrlKey)  mods.push("Ctrl");
      if (e.altKey)   mods.push("Option");
      if (e.shiftKey) mods.push("Shift");

      if (MODIFIER_KEYS.has(e.key)) {
        const label = keyToLabel(e.key);
        lastModifierRef.current = label;
        setPreview([label]);
        return;
      }

      const parts = [...mods, keyToLabel(e.key)];
      setPreview(parts);
      onChange(parts.join("+"));
      stopCapture();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_KEYS.has(e.key) && lastModifierRef.current) {
        const stillHeld = [e.metaKey, e.ctrlKey, e.altKey, e.shiftKey].filter(Boolean).length;
        if (stillHeld === 0) {
          onChange(lastModifierRef.current);
          stopCapture();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stopCapture);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stopCapture);
    };
  }, [capturing, onChange, stopCapture]);

  const displayParts = preview.length > 0 ? preview : parseCombo(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        ref={btnRef}
        disabled={disabled}
        type="button"
        onMouseDown={(e) => { e.preventDefault(); beginCapture(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginCapture(); }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          border: `2px solid ${capturing ? "var(--accent)" : "var(--border-light)"}`,
          background: capturing ? "var(--bg-2)" : "var(--bg)",
          borderRadius: 0,
          outline: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          transition: "border-color 0.1s, background 0.1s",
        }}
        onMouseEnter={(e) => {
          if (!capturing) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
        }}
        onMouseLeave={(e) => {
          if (!capturing) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-light)";
        }}
        title={capturing ? "Press any key combination…" : "Click to change hotkey"}
      >
        {capturing && preview.length === 0 ? (
          <span
            style={{
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            Press any key…
          </span>
        ) : (
          <KbdGroup>
            {displayParts.map((k, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Kbd
                  className={
                    capturing
                      ? "text-[var(--accent)] border-[var(--accent)]"
                      : undefined
                  }
                >
                  {MOD_SYMBOL[k] ?? k}
                </Kbd>
                {i < displayParts.length - 1 && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      userSelect: "none",
                    }}
                  >
                    +
                  </span>
                )}
              </span>
            ))}
          </KbdGroup>
        )}
      </button>

      {capturing && (
        <button
          type="button"
          onClick={() => { onChange("Fn"); stopCapture(); }}
          style={{
            alignSelf: "flex-start",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            border: "1px solid var(--border-light)",
            padding: "2px 8px",
            background: "var(--bg)",
            cursor: "pointer",
            borderRadius: 0,
            color: "var(--text-muted)",
            outline: "none",
          }}
        >
          Use Fn key
        </button>
      )}
    </div>
  );
}
