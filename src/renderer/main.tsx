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

window.addEventListener("error", (event) => {
  window.vaani.reportRendererError({
    message: event.message || "Renderer error",
    stack: event.error instanceof Error ? event.error.stack : undefined
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  window.vaani.reportRendererError({
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

class RendererErrorBoundary extends React.Component<React.PropsWithChildren, { message: string | null }> {
  state = { message: null };

  static getDerivedStateFromError(error: Error): { message: string } {
    return { message: error.message || "The window could not render." };
  }

  componentDidCatch(error: Error): void {
    window.vaani.reportRendererError({
      message: error.message || "Renderer error",
      stack: error.stack
    });
  }

  render(): React.ReactNode {
    if (this.state.message) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
          <div>
            <h1 className="text-base font-semibold">Vaani could not open this window.</h1>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{this.state.message}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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
      <RendererErrorBoundary>
        <AppRoot />
      </RendererErrorBoundary>
    </HashRouter>
  </React.StrictMode>
);

requestAnimationFrame(() => {
  window.vaani.reportRendererReady();
});
