import { afterEach, describe, expect, it, vi } from "vitest";
import { validateBearerEndpoint } from "@main/providers/validation";

const URL = "https://example.test/models";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("API key check messages", () => {
  it.each([
    [200, true, "Groq API key is valid."],
    [401, false, "Groq rejected the API key. Check that you pasted the whole key."],
    [403, false, "Groq rejected the API key. Check that you pasted the whole key."],
    [429, false, "Groq is limiting requests right now. Your key may be fine. Try again in a minute."],
    [503, false, "Groq is having trouble right now (status 503). Your key may be fine. Try again later."],
    [404, false, "Groq validation failed with status 404."],
  ])("status %i reads as a clear result", async (status, valid, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    expect(await validateBearerEndpoint("Groq", URL, "key")).toEqual({ valid, message });
  });

  it("says the service couldn't be reached when the request never connects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await validateBearerEndpoint("Deepgram", URL, "key")).toEqual({
      valid: false,
      message: "Couldn't reach Deepgram. Check your internet connection and try again.",
    });
  });

  it("says the service didn't answer in time when the check times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));

    const result = validateBearerEndpoint("OpenAI", URL, "key");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await result).toEqual({
      valid: false,
      message: "OpenAI didn't answer within 5 seconds. Check your internet connection and try again.",
    });
  });
});
