import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./styles/globals.css";
import App from "./App";

import { VaaniUiProvider } from "./context/vaani-ui";
import { useDictation } from "./hooks/useDictation";
import { useHistory } from "./hooks/useHistory";
import { useSettings } from "./hooks/useSettings";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

const START_TIMEOUT_MS = 3_000;

function AppRoot() {
  const dictation = useDictation();
  const history = useHistory();
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const { bars, startRecording, stopRecording } = useAudioRecorder();

  const prevStateRef = useRef(dictation);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    void window.__VAANI_RECORDER__.reportRecorderReady();
  }, []);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = dictation;

    if (dictation.status === "recording" && prev.status !== "recording") {
      const sessionId = (dictation as { sessionId: string }).sessionId;
      startPromiseRef.current = startRecording();
      startPromiseRef.current.then((started) => {
        if (!started) {
          void window.__VAANI_RECORDER__.reportRecorderFailure({
            sessionId,
            message: "Microphone recording could not start.",
          });
        }
      });
    }

    if (prev.status === "recording" && dictation.status !== "recording") {
      if (dictation.status === "finalizing") {
        void handleStopRecording(
          startPromiseRef.current ?? Promise.resolve(false),
        );
        startPromiseRef.current = null;
      } else {
        startPromiseRef.current = null;
        void stopRecording();
      }
    }

    async function handleStopRecording(startPromise: Promise<boolean>) {
      const started = await Promise.race([
        startPromise,
        new Promise<boolean>((r) => setTimeout(() => r(false), START_TIMEOUT_MS)),
      ]);

      if (!started) {
        void stopRecording();
        await window.__VAANI_RECORDER__.reportRecorderFailure({
          sessionId: (dictation as { sessionId: string }).sessionId,
          message: "Recording could not be finalized.",
        });
        return;
      }

      const result = await stopRecording();
      if (result) {
        await window.__VAANI_RECORDER__.submitAudioClip({
          sessionId: (dictation as { sessionId: string }).sessionId,
          clip: result.clip,
        });
        return;
      }
      await window.__VAANI_RECORDER__.reportRecorderFailure({
        sessionId: (dictation as { sessionId: string }).sessionId,
        message: "Recording could not be finalized.",
      });
    }
  }, [dictation, startRecording, stopRecording]);

  useEffect(() => {
    if (dictation.status === "completed") {
      void history.reload();
    }
  }, [dictation.status, history.reload]);

  return (
    <VaaniUiProvider
      dictation={dictation}
      bars={bars}
      settings={settings}
      settingsLoading={settingsLoading}
      updateSettings={updateSettings}
      history={history}
    >
      <App />
    </VaaniUiProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <AppRoot />
    </HashRouter>
  </React.StrictMode>
);
