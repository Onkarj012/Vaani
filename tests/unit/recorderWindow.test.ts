import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { RecorderSuspensionAck } from "@shared/types";
import { RecorderWindowController } from "@main/recorderWindow";

describe("RecorderWindowController", () => {
  it("does not defer interruption after the renderer finalized its session", async () => {
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      on: vi.fn(),
    } as unknown as BrowserWindow;
    const controller = new RecorderWindowController();
    const state = controller as unknown as { window: BrowserWindow | null; ready: boolean };
    state.window = window;
    state.ready = true;

    controller.startRecording("renderer-session");
    const suspension = controller.suspendForLifecycle();
    const ack: RecorderSuspensionAck = {
      sessionId: "renderer-session",
      ok: true,
      partialClip: { pcmData: [0.1], sampleRate: 16_000, durationSeconds: 0.5, rmsFrames: [0.1] },
    };
    expect(controller.acknowledgeLifecycleSuspension(ack)).toBe(true);

    await expect(suspension).resolves.toMatchObject({
      wasRunning: true,
      sessionId: "renderer-session",
      recordingResumed: false,
      partialClip: ack.partialClip,
    });
  });
});
