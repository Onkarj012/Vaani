import { useCallback, useEffect, useState } from "react";

// "auto" shows the card for the first few dictations; "on" and "off" are the user's choice.
export type DictateTipMode = "auto" | "on" | "off";

const STORAGE_KEY = "vaani-dictate-tip";
const CHANGE_EVENT = "vaani-dictate-tip-change";
export const DICTATE_TIP_DICTATIONS = 5;

// Reads the saved mode, falling back to "auto" when storage is empty or blocked.
function readMode(): DictateTipMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "on" || value === "off" ? value : "auto";
  } catch {
    return "auto";
  }
}

// Whether Home shows the "How to dictate" card, shared by Home and Settings › Appearance.
export function useDictateTip(dictationCount: number) {
  const [mode, setModeState] = useState<DictateTipMode>(readMode);

  useEffect(() => {
    const sync = () => setModeState(readMode());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const setMode = useCallback((next: DictateTipMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be blocked; the choice then lasts until the window reloads.
    }
    setModeState(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const visible = mode === "on" || (mode === "auto" && dictationCount < DICTATE_TIP_DICTATIONS);
  const remaining = Math.max(0, DICTATE_TIP_DICTATIONS - dictationCount);
  return { visible, mode, remaining, setVisible: (show: boolean) => setMode(show ? "on" : "off") };
}
