import type { RecoveryReadiness } from "@shared/recoveryReadiness";
import { useCallback, useEffect, useRef, useState } from "react";
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

export interface HistoryReloadState { generation: number }

export async function loadHistoryData(
  state: HistoryReloadState,
  api: Pick<Window["vaani"], "getHistory" | "getRecoveryReadiness" | "getRecoveryEntries">,
  update: {
    loading: (value: boolean) => void;
    entries: (value: DictationEntry[]) => void;
    readiness: (value: RecoveryReadiness) => void;
    recoveryEntries: (value: RecoveryEntryView[]) => void;
  },
): Promise<void> {
  const generation = ++state.generation;
  update.loading(true);
  try {
    try {
      const entries = await api.getHistory();
      if (generation !== state.generation) return;
      if (Array.isArray(entries)) update.entries(entries);
    } catch {
      // Keep the previous list when history IPC fails.
    }
    try {
      const readiness = await api.getRecoveryReadiness();
      if (generation !== state.generation) return;
      if (readiness.state === "ready") {
        const entries = await api.getRecoveryEntries();
        if (generation !== state.generation) return;
        if (Array.isArray(entries)) update.recoveryEntries(entries);
      } else {
        update.recoveryEntries([]);
      }
      update.readiness(readiness);
    } catch {
      if (generation === state.generation) update.readiness({ state: "degraded", entryCount: null });
    }
  } finally {
    if (generation === state.generation) update.loading(false);
  }
}

export async function runRecoveryMutation(action: () => Promise<boolean>, reload: () => Promise<void>): Promise<void> {
  if (!await action()) throw new Error("Recovery action could not be completed. Try again.");
  await reload();
}

export function useHistory() {
  const [recoveryReadiness, setRecoveryReadiness] = useState<RecoveryReadiness>({ state: "initializing", entryCount: null });
  const [entries, setEntries] = useState<DictationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [recoveryEntries, setRecoveryEntries] = useState<RecoveryEntryView[]>([]);
  const reloadState = useRef<HistoryReloadState>({ generation: 0 });

  const reload = useCallback(() => loadHistoryData(reloadState.current, window.vaani, {
    loading: setLoading,
    entries: setEntries,
    readiness: setRecoveryReadiness,
    recoveryEntries: setRecoveryEntries,
  }), []);

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
    retryRecoveryTranscription: (id: string) => runRecoveryMutation(() => window.vaani.retryRecoveryTranscription(id), reload),
    retryRecoveryFormatting: (id: string) => runRecoveryMutation(() => window.vaani.retryRecoveryFormatting(id), reload),
    useRawRecoveryTranscript: (id: string) => runRecoveryMutation(() => window.vaani.useRawRecoveryTranscript(id), reload),
    retryRecoveryInsertion: (id: string) => runRecoveryMutation(() => window.vaani.retryRecoveryInsertion(id), reload),
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
