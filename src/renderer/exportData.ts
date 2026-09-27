import type { DictationEntry, Settings } from "@shared/types";
import { bounded } from "@shared/recovery";

export function createExportPayload(settings: Settings, history: DictationEntry[]) {
  return {
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      groqApiKey: "",
      providerApiKeys: (settings.providerApiKeys ?? []).map((pk) => ({
        providerId: pk.providerId,
        key: "",
        hasKey: pk.hasKey === true || pk.key.trim().length > 0,
        lastValidation: pk.lastValidation ?? null,
      })),
    },
    history: history.map((entry) => ({
      ...entry,
      id: bounded(entry.id),
      traceId: entry.traceId ? bounded(entry.traceId) : null,
      rawText: entry.rawText,
      formattedText: entry.formattedText,
      cleanedText: entry.cleanedText,
      appBundleId: entry.appBundleId ? bounded(entry.appBundleId) : null,
      appName: entry.appName ? bounded(entry.appName) : null,
      language: entry.language ? bounded(entry.language) : null,
      detectedLanguage: entry.detectedLanguage ? bounded(entry.detectedLanguage) : null,
      rawAudioPath: null,
    })),
  };
}
