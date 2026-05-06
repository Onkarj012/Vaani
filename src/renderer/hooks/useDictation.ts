import { useEffect, useState } from "react";
import type { DictationState } from "@shared/types";

export function useDictation() {
  const [state, setState] = useState<DictationState>({ status: "idle" });

  useEffect(() => {
    const unsub = window.vaani.onStateChange(setState);
    return unsub;
  }, []);

  return state;
}
