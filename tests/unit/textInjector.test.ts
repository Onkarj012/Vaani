import { describe, expect, it } from "vitest";
import { isClipboardOnlyTarget, shouldPreferClipboardInjection } from "../../src/main/injection/policy";

describe("TextInjector policy", () => {
  it("uses clipboard-only insertion for apps that cannot be safely confirmed through AX", () => {
    const target = {
      appBundleId: "net.whatsapp.WhatsApp",
      appName: "WhatsApp"
    };

    expect(isClipboardOnlyTarget(target)).toBe(true);
    expect(shouldPreferClipboardInjection("hello world", target)).toBe(true);
  });

  it("prefers clipboard insertion for multiline text in native editors", () => {
    expect(shouldPreferClipboardInjection("hello\nworld", {
      appBundleId: "com.apple.TextEdit",
      appName: "TextEdit"
    })).toBe(true);
  });

  it("prefers the UTF-8 clipboard path for multilingual text before AX insertion", () => {
    expect(shouldPreferClipboardInjection("मेरा नाम ओंकार है.", {
      appBundleId: "com.apple.TextEdit",
      appName: "TextEdit"
    })).toBe(true);
  });
});
