import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";

export function buildResetSettingsPatch(current: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    providerApiKeys: (current.providerApiKeys ?? []).map((provider) => ({
      providerId: provider.providerId,
      key: "",
      hasKey: provider.hasKey,
      lastValidation: provider.lastValidation ?? null,
    })),
  };
}
