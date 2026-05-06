import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

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
    } catch { /* ignore */ }
  }, []);

  return { settings, loading, updateSettings, reload };
}
