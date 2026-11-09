export interface RecoveryReadiness {
  state: "disabled" | "initializing" | "ready" | "degraded";
  entryCount: number | null;
}

// History shows this on every visit while recovery is off, so it says what that means for a dictation.
export function recoveryReadinessMessage(readiness: RecoveryReadiness): string {
  switch (readiness.state) {
    case "disabled": return "This build doesn't keep an unfinished dictation for retry. Finished ones stay in History.";
    case "initializing": return "Loading unfinished dictations. They'll show up here in a moment.";
    case "degraded": return "Unfinished dictations can't be opened right now. Restart Vaani and try again. Finished ones are still in History.";
    case "ready": return readiness.entryCount === 0 ? "No unfinished dictations. Finished ones stay in History." : "Unfinished dictations can be retried from here.";
  }
}
