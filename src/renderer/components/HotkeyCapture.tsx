import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/Kbd";

interface HotkeyCaptureProps {
  value: string;
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
    <div className="flex flex-col gap-2">
      <button
        ref={btnRef}
        disabled={disabled}
        type="button"
        onMouseDown={(e) => { e.preventDefault(); beginCapture(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginCapture(); }
        }}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-2xl border bg-surface px-4 py-3 outline-none transition-all",
          capturing ? "border-accent" : "border-line hover:border-ink/20",
          disabled && "cursor-not-allowed opacity-40"
        )}
        title={capturing ? "Press any key combination…" : "Click to change hotkey"}
      >
        {capturing && preview.length === 0 ? (
          <span className="label-meta text-[11px] text-accent">Press any key…</span>
        ) : (
          <KbdGroup>
            {displayParts.map((k, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <Kbd className={cn(capturing && "border-accent bg-accent/10 text-accent")}>{MOD_SYMBOL[k] ?? k}</Kbd>
                {i < displayParts.length - 1 && <span className="text-[11px] text-faint">+</span>}
              </span>
            ))}
          </KbdGroup>
        )}
      </button>

      {capturing && (
        <button
          type="button"
          onClick={() => { onChange("Fn"); stopCapture(); }}
          className="label-meta w-fit cursor-pointer rounded-lg border border-line bg-bg px-2 py-1 text-[9px] text-muted transition-colors hover:bg-surface"
        >
          Use Fn key
        </button>
      )}
    </div>
  );
}
