import { useCallback, useEffect, useState } from "react";
import type { UpdateNotificationPayload } from "@shared/types";

export function useUpdateNotification() {
  const [notification, setNotification] = useState<UpdateNotificationPayload | null>(null);

  useEffect(() => {
    return window.vaani.onUpdateNotification((payload) => {
      setNotification(payload);
      if (payload.status === "no-update") {
        setTimeout(() => setNotification(null), 4000);
      }
    });
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
