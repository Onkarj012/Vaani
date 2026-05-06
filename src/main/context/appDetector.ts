import { nativeBridge } from "../nativeBridge";

const CASUAL_APPS = new Set([
  "com.tinyspeck.slackmacgap", "com.hnc.Discord",
  "com.apple.MobileSMS", "net.whatsapp.WhatsApp", "org.telegram.desktop"
]);

const FORMAL_APPS = new Set([
  "com.apple.mail", "com.apple.Notes", "com.microsoft.Word", "com.apple.Pages"
]);

const DEVELOPER_APPS = new Set([
  "com.microsoft.VSCode", "com.apple.Terminal", "com.googlecode.iterm2",
  "com.apple.dt.Xcode", "dev.warp.Warp-Stable", "com.panic.Nova"
]);

export type AppContext = "casual" | "formal" | "developer" | "default";

export interface AppContextResult {
  appBundleId: string | null;
  appName: string | null;
  context: AppContext;
}

export function bundleIdToContext(bundleId: string | null): AppContext {
  if (!bundleId) return "default";
  if (CASUAL_APPS.has(bundleId)) return "casual";
  if (FORMAL_APPS.has(bundleId)) return "formal";
  if (DEVELOPER_APPS.has(bundleId)) return "developer";
  return "default";
}

export class AppDetector {
  getContext(): AppContextResult {
    try {
      const app = nativeBridge.getFrontmostApplication?.();
      const bundleId = app?.bundleId ?? null;
      return { appBundleId: bundleId, appName: app?.name ?? null, context: bundleIdToContext(bundleId) };
    } catch {
      return { appBundleId: null, appName: null, context: "default" };
    }
  }
}
