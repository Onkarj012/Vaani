import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await window.vaani.getSettings();
      setSettings(s);
    } catch {
      /* use defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    try {
      const updated = await window.vaani.updateSettings(patch);
      setSettings(updated);
      setSaveError(null);
    } catch (err) {
      setSaveError(readableIpcError(err));
    }
  }, []);

  const dismissSaveError = useCallback(() => setSaveError(null), []);

  return { settings, loading, updateSettings, reload, saveError, dismissSaveError };
}

// Electron prefixes main-process errors with "Error invoking remote method ...: Error: ".
function readableIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
