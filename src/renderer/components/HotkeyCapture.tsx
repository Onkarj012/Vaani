import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col gap-1.5">
      <button
        ref={btnRef}
        disabled={disabled}
        type="button"
        onMouseDown={(e) => { e.preventDefault(); beginCapture(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginCapture(); }
        }}
        className={cn(
          "w-fit inline-flex items-center gap-1.5 px-3 py-2.5 border-2 outline-none transition-all rounded-xl",
          capturing
            ? "bg-vaani-gray-50 dark:bg-vaani-gray-800 border-vaani-pink"
            : "bg-vaani-gray-50 dark:bg-vaani-gray-800 border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-600",
          disabled && "cursor-not-allowed opacity-40"
        )}
        title={capturing ? "Press any key combination…" : "Click to change hotkey"}
      >
        {capturing && preview.length === 0 ? (
          <span className="text-[11px] font-bold uppercase tracking-widest text-vaani-pink">
            Press any key…
          </span>
        ) : (
          <KbdGroup>
            {displayParts.map((k, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <Kbd className={cn(capturing && "border-vaani-pink text-vaani-pink bg-vaani-pink/10 dark:bg-vaani-pink/20")}>
                  {MOD_SYMBOL[k] ?? k}
                </Kbd>
                {i < displayParts.length - 1 && (
                  <span className="text-[11px] text-vaani-gray-500 dark:text-vaani-gray-400">+</span>
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
          className="self-start text-[9px] font-bold uppercase tracking-widest border px-2 py-0.5 cursor-pointer rounded-md bg-white dark:bg-vaani-gray-900 border-vaani-gray-200 dark:border-vaani-gray-700 text-vaani-gray-500 dark:text-vaani-gray-400 hover:bg-vaani-gray-50 dark:hover:bg-vaani-gray-800 transition-colors"
        >
          Use Fn key
        </button>
      )}
    </div>
  );
}
