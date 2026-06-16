import type { DictationEntry, Settings } from "@shared/types";

export function createExportPayload(settings: Settings, history: DictationEntry[]) {
  return {
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      groqApiKey: "",
      providerApiKeys: (settings.providerApiKeys ?? []).map((pk) => ({ providerId: pk.providerId, key: "" })),
    },
    history,
  };
}
