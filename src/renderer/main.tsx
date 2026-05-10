import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { useEffect, useState } from "react";
import "./styles/globals.css";
import App from "./App";

import { VaaniUiProvider } from "./context/vaani-ui";
import { useDictation } from "./hooks/useDictation";
import { useHistory } from "./hooks/useHistory";
import { useSettings } from "./hooks/useSettings";

function AppRoot() {
  const dictation = useDictation();
  const history = useHistory();
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const [bars, setBars] = useState<number[]>(new Array(9).fill(0));

  useEffect(() => {
    return window.vaani.onAudioLevel((_level, nextBars) => {
      if (nextBars?.length) {
        setBars(nextBars);
      }
    });
  }, []);

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
