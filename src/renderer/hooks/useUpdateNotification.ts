import { useCallback, useEffect, useState } from "react";
import type { UpdateNotificationPayload } from "@shared/types";

export function useUpdateNotification() {
  const [notification, setNotification] = useState<UpdateNotificationPayload | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const unsub = window.vaani.onUpdateNotification((payload) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      setNotification(payload);
      if (payload.status === "no-update") {
        timeoutId = setTimeout(() => setNotification(null), 4000);
      }
    });
    return () => {
      unsub();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    setNotification({ status: "checking", message: "Checking for updates…" });
    try {
      await window.vaani.checkForUpdates();
    } catch (err) {
      setNotification({
        status: "error",
        message: err instanceof Error ? err.message : "Update check failed",
      });
    }
  }, []);

  const dismiss = useCallback(() => setNotification(null), []);

  return { notification, checkForUpdates, dismiss };
}
