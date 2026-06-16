import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn((_command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  callback(null, "", "");
});
const execFileMock = vi.fn((_file: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  callback(null, "", "");
});

vi.mock("node:child_process", () => ({
  exec: execMock,
  execFile: execFileMock,
}));

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

describe("macAudioSession", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    execMock.mockClear();
    execFileMock.mockClear();
  });

  afterEach(() => {
    stubPlatform(originalPlatform);
  });

  it("sets a device with execFile arguments instead of a shell command", async () => {
    stubPlatform("darwin");
    const { setAudioInputDevice } = await import("@main/audio/macAudioSession");

    await expect(setAudioInputDevice("Built-in Microphone")).resolves.toBe(true);

    expect(execFileMock).toHaveBeenCalledWith(
      "SwitchAudioSource",
      ["-t", "input", "-s", "Built-in Microphone"],
      expect.any(Function),
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  it("keeps shell metacharacters inside a single device-name argument", async () => {
    stubPlatform("darwin");
    const payload = 'x"; touch /tmp/pwned; "';
    const { setAudioInputDevice } = await import("@main/audio/macAudioSession");

    await expect(setAudioInputDevice(payload)).resolves.toBe(true);

    expect(execFileMock).toHaveBeenCalledWith(
      "SwitchAudioSource",
      ["-t", "input", "-s", payload],
      expect.any(Function),
    );
    expect(execMock).not.toHaveBeenCalledWith(expect.stringContaining(payload), expect.any(Function));
  });

  it("does nothing outside macOS", async () => {
    stubPlatform("linux");
    const { setAudioInputDevice } = await import("@main/audio/macAudioSession");

    await expect(setAudioInputDevice("Built-in Microphone")).resolves.toBe(false);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });
});
