import { useCallback, useEffect, useState } from "react";
import type { DictationEntry } from "@shared/types";

export function useHistory() {
  const [entries, setEntries] = useState<DictationEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.vaani.getHistory();
      setEntries(Array.isArray(data) ? data : []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return {
    entries,
    loading,
    reload,
    updateEntry: async (id: string, cleanedText: string) => {
      await window.vaani.updateHistoryEntry(id, cleanedText);
      await reload();
    },
    deleteEntry: async (id: string) => {
      await window.vaani.deleteEntry(id);
      await reload();
    },
    reinjectEntry: async (id: string) => {
      await window.vaani.reinjectEntry(id);
    },
    clearAll: async () => {
      await window.vaani.clearHistory();
      await reload();
    }
  };
}
