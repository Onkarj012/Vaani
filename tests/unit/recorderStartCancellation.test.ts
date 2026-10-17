import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecorderCommand } from "@shared/types";

// Hold an input operation open until the test chooses to finish it.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("renderer recorder start cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("aborts starts waiting for input preparation or microphone access", async () => {
    for (const abortAt of ["prepare", "microphone"] as const) {
      vi.resetModules();
      const prepare = deferred<number | null>();
      const microphone = deferred<MediaStream>();
      const track = { onended: null, onmute: null, stop: vi.fn() };
      let onStart: ((command: RecorderCommand) => void) | undefined;
      let onAbort: ((command: RecorderCommand) => void) | undefined;

      const recorderApi = {
        onStartRecording: (callback: (command: RecorderCommand) => void) => { onStart = callback; return () => {}; },
        onStopRecording: () => () => {},
        onAbortRecording: (callback: (command: RecorderCommand) => void) => { onAbort = callback; return () => {}; },
        onSuspendRecording: () => () => {},
        onResumeRecording: () => () => {},
        onRecorderConfigChanged: () => () => {},
        getRecorderConfig: async () => ({ preWarmMic: false }),
        reportRecorderReady: async () => {},
        reportRecorderStarted: vi.fn(async () => {}),
        reportAudioFrame: async () => {},
        reportRecorderFailure: async () => {},
        reportRecorderSuspended: async () => {},
        submitAudioClip: async () => {},
        prepareRecordingInput: vi.fn(abortAt === "prepare" ? () => prepare.promise : async () => 7),
        restoreRecordingInput: vi.fn(async () => true),
        listAudioInputDevices: async () => [{ uid: "built-in", name: "Built-in Microphone", transportType: "built-in", isPhysical: true }],
        requestMicrophonePermission: async () => "granted" as const,
      };
      vi.stubGlobal("window", { __VAANI_RECORDER__: recorderApi });
      vi.stubGlobal("navigator", {
        mediaDevices: {
          enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "Built-in Microphone" }],
          getUserMedia: vi.fn(() => microphone.promise),
        },
      });
      vi.stubGlobal("MediaStream", class {
        // Expose the microphone track so cancellation can release it.
        getTracks() { return [track]; }
      });
      vi.stubGlobal("AudioContext", class {
        sampleRate = 48_000;
        state = "running";
        destination = {};
        audioWorklet = { addModule: async () => { throw new Error("worklet unavailable"); } };
        // Supply the source node used to connect microphone capture.
        createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
        // Supply the fallback processor used when worklets are unavailable.
        createScriptProcessor() { return { onaudioprocess: null, connect: () => {}, disconnect: () => {} }; }
        resume = async () => {};
        close = async () => {};
      });

      await import("@renderer/recorder/main");
      const command: RecorderCommand = { sessionId: `cancel-${abortAt}`, config: { preWarmMic: false } };
      onStart?.(command);
      if (abortAt === "microphone") {
        await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
      }
      onAbort?.({ sessionId: command.sessionId, config: command.config });

      const openedStream = new MediaStream();
      if (abortAt === "prepare") prepare.resolve(7);
      else microphone.resolve(openedStream);

      await vi.waitFor(() => {
        expect(recorderApi.restoreRecordingInput).toHaveBeenCalledWith(7);
        expect(track.stop).toHaveBeenCalledTimes(abortAt === "microphone" ? 1 : 0);
      });
      expect(recorderApi.reportRecorderStarted).not.toHaveBeenCalled();
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(abortAt === "microphone" ? 1 : 0);
    }
  });
});
