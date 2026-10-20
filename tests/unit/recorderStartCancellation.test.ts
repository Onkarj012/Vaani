import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecorderCommand } from "@shared/types";

// Hold an input operation open until the test chooses to finish it.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

// Loads the renderer recorder with stubbed input preparation and microphone access.
async function loadRecorder(prepareInput: () => Promise<number | null>) {
  vi.resetModules();
  const microphones: Array<{ resolve: (stream: MediaStream) => void; track: { onended: null; onmute: null; stop: ReturnType<typeof vi.fn> } }> = [];
  let onStart: ((command: RecorderCommand) => void) | undefined;
  let onAbort: ((command: RecorderCommand) => void) | undefined;

  const recorderApi = {
    onStartRecording: (callback: (command: RecorderCommand) => void) => { onStart = callback; return () => {}; },
    onStopRecording: () => () => {},
    onAbortRecording: (callback: (command: RecorderCommand) => void) => { onAbort = callback; return () => {}; },
    onSuspendRecording: () => () => {},
    onResumeRecording: () => () => {},
    onPauseCapture: () => () => {},
    onResumeCapture: () => () => {},
    onRecorderConfigChanged: () => () => {},
    getRecorderConfig: async () => ({ preWarmMic: false }),
    reportRecorderReady: async () => {},
    reportRecorderStarted: vi.fn(async (_sessionId: string) => {}),
    reportAudioFrame: async () => {},
    reportRecorderFailure: async () => {},
    reportRecorderSuspended: async () => {},
    submitAudioClip: async () => {},
    prepareRecordingInput: vi.fn(prepareInput),
    restoreRecordingInput: vi.fn(async () => true),
    listAudioInputDevices: async () => [{ uid: "built-in", name: "Built-in Microphone", transportType: "built-in", isPhysical: true }],
    requestMicrophonePermission: async () => "granted" as const,
  };
  vi.stubGlobal("window", { __VAANI_RECORDER__: recorderApi });
  vi.stubGlobal("MediaStream", class {
    track = { onended: null, onmute: null, stop: vi.fn() };
    // Expose the microphone track so cancellation can release it.
    getTracks() { return [this.track]; }
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "Built-in Microphone" }],
      getUserMedia: vi.fn(() => {
        const microphone = deferred<MediaStream>();
        const stream = new MediaStream() as MediaStream & { track: { onended: null; onmute: null; stop: ReturnType<typeof vi.fn> } };
        microphones.push({ resolve: () => microphone.resolve(stream), track: stream.track });
        return microphone.promise;
      }),
    },
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
  const command = (sessionId: string): RecorderCommand => ({ sessionId, config: { preWarmMic: false } });
  return {
    recorderApi,
    microphones,
    getUserMedia: navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>,
    start: (sessionId: string) => onStart?.(command(sessionId)),
    abort: (sessionId: string) => onAbort?.(command(sessionId)),
  };
}

describe("renderer recorder start cancellation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("aborts starts waiting for input preparation or microphone access", async () => {
    for (const abortAt of ["prepare", "microphone"] as const) {
      const prepare = deferred<number | null>();
      const recorder = await loadRecorder(abortAt === "prepare" ? () => prepare.promise : async () => 7);
      recorder.start(`cancel-${abortAt}`);
      await vi.waitFor(() => expect(abortAt === "microphone" ? recorder.getUserMedia : recorder.recorderApi.prepareRecordingInput).toHaveBeenCalledOnce());
      recorder.abort(`cancel-${abortAt}`);

      if (abortAt === "prepare") prepare.resolve(7);
      else recorder.microphones[0]?.resolve(new MediaStream());

      await vi.waitFor(() => {
        expect(recorder.recorderApi.restoreRecordingInput).toHaveBeenCalledWith(7);
        expect(recorder.microphones[0]?.track.stop ?? vi.fn()).toHaveBeenCalledTimes(abortAt === "microphone" ? 1 : 0);
      });
      expect(recorder.recorderApi.reportRecorderStarted).not.toHaveBeenCalled();
      expect(recorder.getUserMedia).toHaveBeenCalledTimes(abortAt === "microphone" ? 1 : 0);
    }
  });

  it("keeps the next recording's microphone open when it starts during a cancelled open", async () => {
    const recorder = await loadRecorder(async () => 7);
    recorder.start("cancelled");
    await vi.waitFor(() => expect(recorder.getUserMedia).toHaveBeenCalledOnce());
    recorder.abort("cancelled");
    recorder.start("next");
    recorder.microphones[0]?.resolve(new MediaStream());

    await vi.waitFor(() => expect(recorder.getUserMedia).toHaveBeenCalledTimes(2));
    recorder.microphones[1]?.resolve(new MediaStream());

    await vi.waitFor(() => expect(recorder.recorderApi.reportRecorderStarted).toHaveBeenCalledWith("next"));
    expect(recorder.recorderApi.reportRecorderStarted).not.toHaveBeenCalledWith("cancelled");
    expect(recorder.microphones[0]?.track.stop).toHaveBeenCalledOnce();
    expect(recorder.microphones[1]?.track.stop).not.toHaveBeenCalled();
  });
});
