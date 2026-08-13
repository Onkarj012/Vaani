import { describe, expect, it } from "vitest";
import type { MacOSPermissionState, PermissionStatus } from "@shared/types";
import {
  getAccessibilityPermissionRemediation,
  getMicrophonePermissionRemediation,
  isPermissionReady,
} from "@shared/permissionGuard";

const states: MacOSPermissionState[] = ["not-determined", "granted", "denied", "restricted", "unknown"];

describe("permission guard policy", () => {
  it("is ready only when both permissions are exactly granted", () => {
    expect(isPermissionReady({ microphone: "granted", accessibility: "granted" })).toBe(true);
    for (const microphone of states) {
      for (const accessibility of states) {
        const status: PermissionStatus = { microphone, accessibility };
        expect(isPermissionReady(status)).toBe(microphone === "granted" && accessibility === "granted");
      }
    }
  });

  it("maps every microphone state to deterministic remediation", () => {
    expect(getMicrophonePermissionRemediation("not-determined").action).toBe("request");
    expect(getMicrophonePermissionRemediation("not-determined", true)).toEqual({
      action: "open-settings",
      guidance: "macOS did not grant microphone access. Enable Vaani in System Settings, then click Check Again.",
    });
    expect(getMicrophonePermissionRemediation("granted").action).toBe("none");
    expect(getMicrophonePermissionRemediation("denied").action).toBe("open-settings");
    expect(getMicrophonePermissionRemediation("restricted")).toMatchObject({ action: "open-settings", guidance: expect.any(String) });
    expect(getMicrophonePermissionRemediation("unknown").action).toBe("retry");
  });

  it("keeps Accessibility blocked and maps every state", () => {
    expect(getAccessibilityPermissionRemediation("not-determined").action).toBe("request");
    expect(getAccessibilityPermissionRemediation("denied").action).toBe("request");
    expect(getAccessibilityPermissionRemediation("granted").action).toBe("none");
    expect(getAccessibilityPermissionRemediation("restricted")).toMatchObject({ action: "open-settings", guidance: expect.any(String) });
    expect(getAccessibilityPermissionRemediation("unknown").action).toBe("retry");
    expect(isPermissionReady({ microphone: "granted", accessibility: "restricted" })).toBe(false);
    expect(isPermissionReady({ microphone: "granted", accessibility: "unknown" })).toBe(false);
  });
});
