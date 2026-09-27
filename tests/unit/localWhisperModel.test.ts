import { afterEach, describe, expect, it, vi } from "vitest";

describe("LocalWhisperProvider model selection", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("loads the model requested by a session and changes models only when requested", async () => {
    const load = vi.fn((_path: string) => true);
    const mod = {
      whisperLoadModel: load,
      whisperIsModelLoaded: () => true,
      whisperTranscribe: () => "spoken text",
    };
    vi.resetModules();
    const { ensureWhisperModel } = await import("@main/providers/local/whisperCpp");

    ensureWhisperModel(mod, "small.en");
    ensureWhisperModel(mod, "small.en");
    ensureWhisperModel(mod, "base.en");

    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[0]?.[0]).toMatch(/ggml-small\.en\.bin$/);
    expect(load.mock.calls[1]?.[0]).toMatch(/ggml-base\.en\.bin$/);
  });
});
