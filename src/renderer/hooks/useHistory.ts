import type { RecoveryReadiness } from "@shared/recoveryReadiness";
import { useCallback, useEffect, useState } from "react";
import type { DictationEntry } from "@shared/types";
import type { RecoveryEntryView, RecoveryStorageUsage } from "@shared/recovery";

export function pollRecoveryReadiness(reload: () => Promise<void>): () => void {
  let pending = false;
  const timer = setInterval(() => {
    if (pending) return;
    pending = true;
    void reload().finally(() => { pending = false; });
  }, 500);
  return () => clearInterval(timer);
}

export function useHistory() {
  const [recoveryReadiness, setRecoveryReadiness] = useState<RecoveryReadiness>({ state: "initializing", entryCount: null });
  const [entries, setEntries] = useState<DictationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [recoveryEntries, setRecoveryEntries] = useState<RecoveryEntryView[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.vaani.getHistory();
      setEntries(Array.isArray(data) ? data : []);
    } catch {
      setEntries([]);
    }
    try {
      const status = await window.vaani.getRecoveryReadiness();
      setRecoveryReadiness(status);
      const recovery = status.state === "ready" ? await window.vaani.getRecoveryEntries() : [];
      setRecoveryEntries(Array.isArray(recovery) ? recovery : []);
    } catch {
      setRecoveryReadiness({ state: "degraded", entryCount: null });
      setRecoveryEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (recoveryReadiness.state !== "initializing") return;
    return pollRecoveryReadiness(reload);
  }, [recoveryReadiness.state, reload]);

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
    retryEntry: async (id: string) => {
      await window.vaani.retryHistoryEntry(id);
      await reload();
    },
    recoveryEntries,
    recoveryReadiness,
    retryRecoveryTranscription: async (id: string) => { await window.vaani.retryRecoveryTranscription(id); await reload(); },
    retryRecoveryFormatting: async (id: string) => { await window.vaani.retryRecoveryFormatting(id); await reload(); },
    useRawRecoveryTranscript: async (id: string) => { await window.vaani.useRawRecoveryTranscript(id); await reload(); },
    retryRecoveryInsertion: async (id: string) => { await window.vaani.retryRecoveryInsertion(id); await reload(); },
    copyRecoveryEntry: (id: string) => window.vaani.copyRecoveryEntry(id),
    playRecoveryAudio: (id: string) => window.vaani.playRecoveryAudio(id),
    deleteRecoveryAudio: async (id: string) => { const result = await window.vaani.deleteRecoveryAudio(id); await reload(); return result; },
    discardRecoveryEntry: async (id: string) => { const result = await window.vaani.discardRecoveryEntry(id); await reload(); return result; },
    getRecoveryStorageUsage: (): Promise<RecoveryStorageUsage> => window.vaani.getRecoveryStorageUsage(),
    cleanupRecoveryAudio: async (): Promise<RecoveryStorageUsage> => { const result = await window.vaani.cleanupRecoveryAudio(); await reload(); return result; },
    clearRecoveryAudio: async (): Promise<RecoveryStorageUsage> => { const result = await window.vaani.clearRecoveryAudio(); await reload(); return result; },
    clearAll: async () => {
      await window.vaani.clearHistory();
      await reload();
    }
  };
}
