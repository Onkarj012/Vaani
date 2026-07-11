import { describe, expect, it } from "vitest";
import { shouldGrantMediaPermission } from "../../src/main/mediaPermissions";

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

  it("treats an unspecified media type list as audio-only", () => {
    expect(shouldGrantMediaPermission(recorderWebContents, "media", undefined, [recorderWebContents])).toBe(true);
  });
});
