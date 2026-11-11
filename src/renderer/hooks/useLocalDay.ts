import { useEffect, useState } from "react";
import { localDayKey, msUntilNextLocalDay } from "@renderer/lib/historyDerivations";

// The calendar day the history labels were built for. Updates at the next local
// midnight, and again when the window is shown or focused, so a session left open
// overnight does not keep yesterday's clock-only times.
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDayKey());

  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      const next = localDayKey();
      setDay((current) => (current === next ? current : next));
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refresh();
        arm();
      }, msUntilNextLocalDay());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    arm();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return day;
}
