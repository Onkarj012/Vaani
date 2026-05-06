import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./styles/globals.css";

import { ThemeProvider } from "./components/ThemeProvider";

document.documentElement.setAttribute("data-theme", "aurora");

// Headless audio logic is inlined below (no App component needed)

// Context
import { VaaniUiProvider } from "./context/vaani-ui";
import { useDictation } from "./hooks/useDictation";
import { useHistory } from "./hooks/useHistory";
import { useSettings } from "./hooks/useSettings";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

// Pages
import Layout from "./pages/Layout";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import HistoryPage from "./pages/HistoryPage";
import SnippetsPage from "./pages/SnippetsPage";
import DictionaryPage from "./pages/DictionaryPage";
import SettingsPage from "./pages/SettingsPage";

function ThemeRouter() {
  const dictation = useDictation();
  const history = useHistory();
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const { bars, startRecording, stopRecording } = useAudioRecorder();
  const location = useLocation();
  const navigate = useNavigate();

  const defaultRoute = "/4";

  useEffect(() => {
    return window.vaani.onNavigate((route) => {
      navigate(route);
    });
  }, [navigate]);

  return (
    <VaaniUiProvider
      dictation={dictation}
      bars={bars}
      settings={settings}
      settingsLoading={settingsLoading}
      updateSettings={updateSettings}
      history={history}
    >
      <ThemeProvider
        attribute="data-mode"
        forcedTheme={settingsLoading ? undefined : (settings.colorMode ?? "light")}
        enableSystem={false}
        disableTransitionOnChange
      >
        <div 
          className="w-full min-h-screen transition-colors duration-500"
          style={{ backgroundColor: "var(--bg)", color: "var(--text)" }}
        >
          <AppAudio
            dictation={dictation}
            history={history}
            startRecording={startRecording}
            stopRecording={stopRecording}
          />

          <Routes location={location}>
            <Route path="/" element={<Navigate to={defaultRoute} replace />} />

            {/* Vaani theme — /4 */}
            <Route path="/4" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="snippets" element={<SnippetsPage />} />
              <Route path="dictionary" element={<DictionaryPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to={defaultRoute} replace />} />
          </Routes>
        </div>
      </ThemeProvider>
    </VaaniUiProvider>
  );
}

// Headless audio recording component (keeps App.tsx logic inline)
import type { DictationState } from "@shared/types";

const START_TIMEOUT_MS = 3_000;

function AppAudio({
  dictation,
  history,
  startRecording,
  stopRecording,
}: {
  dictation: DictationState;
  history: ReturnType<typeof useHistory>;
  startRecording: ReturnType<typeof useAudioRecorder>["startRecording"];
  stopRecording: ReturnType<typeof useAudioRecorder>["stopRecording"];
}) {
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

  return null;
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <ThemeRouter />
    </HashRouter>
  </React.StrictMode>
);
