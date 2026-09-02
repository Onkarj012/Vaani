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
