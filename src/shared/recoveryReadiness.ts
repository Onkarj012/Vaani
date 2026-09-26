export interface RecoveryReadiness {
  state: "disabled" | "initializing" | "ready" | "degraded";
  entryCount: number | null;
}

export function recoveryReadinessMessage(readiness: RecoveryReadiness): string {
  switch (readiness.state) {
    case "disabled": return "Recovery is disabled in this build. Completed dictations remain in History.";
    case "initializing": return "Recovery is initializing. Saved items have not been loaded yet.";
    case "degraded": return "Recovery is unavailable. Saved data has been preserved; retry after restarting the app.";
    case "ready": return readiness.entryCount === 0 ? "Recovery is ready. No unfinished dictations." : "Recovery is ready.";
  }
}
