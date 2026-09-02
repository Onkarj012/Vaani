import type { DictationEntry, Settings } from "@shared/types";

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
      id: boundedExport(entry.id),
      traceId: entry.traceId ? boundedExport(entry.traceId) : null,
      rawText: boundedExport(entry.rawText),
      formattedText: boundedExport(entry.formattedText),
      cleanedText: boundedExport(entry.cleanedText),
      appBundleId: entry.appBundleId ? boundedExport(entry.appBundleId) : null,
      appName: entry.appName ? boundedExport(entry.appName) : null,
      language: entry.language ? boundedExport(entry.language) : null,
      detectedLanguage: entry.detectedLanguage ? boundedExport(entry.detectedLanguage) : null,
      rawAudioPath: null,
    })),
  };
}

function boundedExport(value: string): string {
  return value.slice(0, 500);
}
