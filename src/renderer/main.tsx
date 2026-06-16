import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { useEffect, useState } from "react";
// Check if this is being loaded as overlay mode
const isOverlayMode = new URLSearchParams(window.location.search).get("mode") === "overlay";

if (!isOverlayMode) {
  try {
    if (localStorage.getItem("vaani-color-mode") === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch {
    // Ignore storage access errors during bootstrap.
  }
}

// Load appropriate CSS based on mode
if (isOverlayMode) {
  import("./overlay/overlay.css");
} else {
  import("./styles/globals.css");
}

// Lazy imports based on mode
const App = isOverlayMode ? null : React.lazy(() => import("./App"));
const CapsuleOverlay = isOverlayMode ? React.lazy(() => import("./overlay/CapsuleOverlay")) : null;

import { VaaniUiProvider } from "./context/vaani-ui";
import { useDictation } from "./hooks/useDictation";
import { useHistory } from "./hooks/useHistory";
import { useSettings } from "./hooks/useSettings";

// Only set up error handlers in main mode (not overlay)
if (!isOverlayMode && typeof window.vaani !== "undefined") {
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
}

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
        <div className="flex min-h-screen items-center justify-center bg-bg px-6 text-center text-ink">
          <div>
            <h1 className="text-base font-semibold">Vaani could not open this window.</h1>
            <p className="mt-2 max-w-sm text-sm text-muted">{this.state.message}</p>
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
      {App && <App />}
    </VaaniUiProvider>
  );
}

const root = document.getElementById("root");
if (!root) {
  console.error("[main] #root element not found");
  throw new Error("Root element not found");
}

if (isOverlayMode && CapsuleOverlay) {
  // Overlay mode - render just the capsule, no providers needed
  createRoot(root).render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <CapsuleOverlay />
      </React.Suspense>
    </React.StrictMode>
  );
} else if (App) {
  // Normal dashboard mode
  createRoot(root).render(
    <React.StrictMode>
      <HashRouter>
        <RendererErrorBoundary>
          <React.Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-bg" />}>
            <AppRoot />
          </React.Suspense>
        </RendererErrorBoundary>
      </HashRouter>
    </React.StrictMode>
  );
}


// Only report ready in main mode (overlay uses capsuleBridge.sendReady)
if (!isOverlayMode && typeof window.vaani !== "undefined") {
  function reportRendererReady(): void {
    window.vaani.reportRendererReady();
  }

  queueMicrotask(reportRendererReady);
  setTimeout(reportRendererReady, 0);
  setTimeout(reportRendererReady, 150);
  setTimeout(reportRendererReady, 350);
}
