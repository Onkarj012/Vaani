import { describe, expect, it } from "vitest";
import { shouldGrantMediaPermission, shouldGrantMediaPermissionCheck } from "../../src/main/mediaPermissions";

describe("shouldGrantMediaPermission", () => {
  const mainWebContents = {};
  const recorderWebContents = {};
  const overlayWebContents = {};

  it("allows audio requests from the main and recorder renderers", () => {
    expect(shouldGrantMediaPermission(mainWebContents, "media", { mediaTypes: ["audio"] }, [mainWebContents, recorderWebContents])).toBe(true);
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: ["audio"] }, [mainWebContents, recorderWebContents])).toBe(true);
  });

  it("denies requests from other windows and non-audio media", () => {
    expect(shouldGrantMediaPermission(overlayWebContents, "media", { mediaTypes: ["audio"] }, [mainWebContents, recorderWebContents])).toBe(false);
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: ["audio", "video"] }, [mainWebContents, recorderWebContents])).toBe(false);
    expect(shouldGrantMediaPermission(recorderWebContents, "notifications", undefined, [mainWebContents, recorderWebContents])).toBe(false);
  });

  it("rejects empty or unspecified media type lists", () => {
    expect(shouldGrantMediaPermission(recorderWebContents, "media", undefined, [recorderWebContents])).toBe(false);
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: [] }, [recorderWebContents])).toBe(false);
  });

  it("rejects video and unknown media types", () => {
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: ["video"] }, [recorderWebContents])).toBe(false);
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: ["audio", "video"] }, [recorderWebContents])).toBe(false);
    expect(shouldGrantMediaPermission(recorderWebContents, "media", { mediaTypes: ["unknown"] }, [recorderWebContents])).toBe(false);
  });
});

describe("shouldGrantMediaPermissionCheck", () => {
  const mainWebContents = {};
  const recorderWebContents = {};
  const overlayWebContents = {};
  const allowed = [mainWebContents, recorderWebContents];

  it("allows audio and unspecified media checks from capture renderers so device labels are available", () => {
    expect(shouldGrantMediaPermissionCheck(recorderWebContents, "media", { mediaType: "audio", isMainFrame: true }, allowed)).toBe(true);
    expect(shouldGrantMediaPermissionCheck(recorderWebContents, "media", { mediaType: "unknown", isMainFrame: true }, allowed)).toBe(true);
    expect(shouldGrantMediaPermissionCheck(mainWebContents, "media", { isMainFrame: true }, allowed)).toBe(true);
  });

  it("denies media checks from other windows, subframes, and video", () => {
    expect(shouldGrantMediaPermissionCheck(overlayWebContents, "media", { mediaType: "audio", isMainFrame: true }, allowed)).toBe(false);
    expect(shouldGrantMediaPermissionCheck(null, "media", { mediaType: "audio", isMainFrame: true }, allowed)).toBe(false);
    expect(shouldGrantMediaPermissionCheck(recorderWebContents, "media", { mediaType: "audio", isMainFrame: false }, allowed)).toBe(false);
    expect(shouldGrantMediaPermissionCheck(recorderWebContents, "media", { mediaType: "video", isMainFrame: true }, allowed)).toBe(false);
  });

  it("keeps Electron's default grant for non-media permission checks", () => {
    expect(shouldGrantMediaPermissionCheck(overlayWebContents, "clipboard-sanitized-write", { isMainFrame: true }, allowed)).toBe(true);
    expect(shouldGrantMediaPermissionCheck(mainWebContents, "notifications", { isMainFrame: true }, allowed)).toBe(true);
  });
});
