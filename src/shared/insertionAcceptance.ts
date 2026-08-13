import type { DictationTrace } from "./types";

export const INSERTION_ACCEPTANCE_TRACE_WINDOW = 200;
export const INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD = 0.95;
export const INSERTION_ACCEPTANCE_APP_THRESHOLD = 0.9;
export const INSERTION_ACCEPTANCE_APP_BINDING_COUNT = 10;

export type InsertionAcceptanceStatus = "warming" | "pass" | "fail";

export interface InsertionAcceptanceCounts {
  inspected: number;
  qualifyingClean: number;
  excluded: number;
  excludedMissingBuildIdentifier: number;
  excludedDirtyBuildIdentifier: number;
  excludedInvalidBuildIdentifier: number;
  excludedBaselineUnreadable: number;
  eligible: number;
  successful: number;
  failed: number;
}

export interface InsertionAcceptanceRate {
  successful: number;
  eligible: number;
  rate: number;
}

export interface InsertionAcceptanceAppReport extends InsertionAcceptanceRate {
  targetAppBundleId: string;
  targetAppName: string | null;
  failed: number;
  bound: boolean;
  passed: boolean;
}

export interface InsertionAcceptanceUnknownReport extends InsertionAcceptanceAppReport {
  targetAppBundleId: "unknown";
}

export interface InsertionAcceptanceReport {
  status: InsertionAcceptanceStatus;
  counts: InsertionAcceptanceCounts;
  rates: {
    aggregate: InsertionAcceptanceRate;
    apps: InsertionAcceptanceAppReport[];
  };
  apps: InsertionAcceptanceAppReport[];
  unknown: InsertionAcceptanceUnknownReport;
}

interface MutableAppReport {
  targetAppBundleId: string;
  targetAppName: string | null;
  successful: number;
  eligible: number;
}

export function evaluateInsertionAcceptance(traces: readonly DictationTrace[]): InsertionAcceptanceReport {
  const inspectedTraces = traces.slice(0, INSERTION_ACCEPTANCE_TRACE_WINDOW);
  const counts: InsertionAcceptanceCounts = {
    inspected: inspectedTraces.length,
    qualifyingClean: 0,
    excluded: 0,
    excludedMissingBuildIdentifier: 0,
    excludedDirtyBuildIdentifier: 0,
    excludedInvalidBuildIdentifier: 0,
    excludedBaselineUnreadable: 0,
    eligible: 0,
    successful: 0,
    failed: 0,
  };
  const appReports = new Map<string, MutableAppReport>();
  const unknownReport = { successful: 0, eligible: 0 };

  for (const trace of inspectedTraces) {
    const buildIdentifier = trace.buildIdentifier;
    if (typeof buildIdentifier !== "string" || buildIdentifier.trim() === "") {
      counts.excluded += 1;
      counts.excludedMissingBuildIdentifier += 1;
      continue;
    }
    if (buildIdentifier.endsWith("-dirty")) {
      counts.excluded += 1;
      counts.excludedDirtyBuildIdentifier += 1;
      continue;
    }
    const finalPlusIndex = buildIdentifier.lastIndexOf("+");
    const commitIdentifier = finalPlusIndex === -1 ? "" : buildIdentifier.slice(finalPlusIndex + 1);
    if (!/^[0-9a-f]{7,40}$/i.test(commitIdentifier)) {
      counts.excluded += 1;
      counts.excludedInvalidBuildIdentifier += 1;
      continue;
    }

    counts.qualifyingClean += 1;
    if (trace.outcome !== "injected" && trace.outcome !== "saved") continue;
    if (trace.qualityDecision?.action !== "insert") continue;
    if (!trace.injectionAttempts || trace.injectionAttempts.length === 0) continue;

    const finalAttempt = trace.injectionAttempts[trace.injectionAttempts.length - 1];
    if (!finalAttempt) continue;
    if (finalAttempt.verification?.reason === "baseline-unreadable") {
      counts.excluded += 1;
      counts.excludedBaselineUnreadable += 1;
      continue;
    }
    const successful = finalAttempt.success === true &&
      finalAttempt.verification?.readable === true &&
      finalAttempt.verification.passed === true;
    counts.eligible += 1;
    if (successful) counts.successful += 1;
    else counts.failed += 1;

    if (finalAttempt.targetAppBundleId === null) {
      unknownReport.eligible += 1;
      if (successful) unknownReport.successful += 1;
      continue;
    }
    const existing = appReports.get(finalAttempt.targetAppBundleId);
    const app = existing ?? {
      targetAppBundleId: finalAttempt.targetAppBundleId,
      targetAppName: finalAttempt.targetAppName,
      successful: 0,
      eligible: 0,
    };
    app.eligible += 1;
    if (successful) app.successful += 1;
    appReports.set(finalAttempt.targetAppBundleId, app);
  }

  const aggregateRate = makeRate(counts.successful, counts.eligible);
  const apps = [...appReports.values()].map((app) => {
    const rate = makeRate(app.successful, app.eligible);
    const bound = app.eligible >= INSERTION_ACCEPTANCE_APP_BINDING_COUNT;
    return {
      targetAppBundleId: app.targetAppBundleId,
      targetAppName: app.targetAppName,
      successful: app.successful,
      eligible: app.eligible,
      failed: app.eligible - app.successful,
      rate: rate.rate,
      bound,
      passed: !bound || rate.rate >= INSERTION_ACCEPTANCE_APP_THRESHOLD,
    };
  });
  const unknownRate = makeRate(unknownReport.successful, unknownReport.eligible);
  const unknown: InsertionAcceptanceUnknownReport = {
    targetAppBundleId: "unknown",
    targetAppName: null,
    successful: unknownReport.successful,
    eligible: unknownReport.eligible,
    failed: unknownReport.eligible - unknownReport.successful,
    rate: unknownRate.rate,
    bound: false,
    passed: true,
  };
  const warm = inspectedTraces.length < INSERTION_ACCEPTANCE_TRACE_WINDOW ||
    counts.qualifyingClean < INSERTION_ACCEPTANCE_TRACE_WINDOW;
  const status: InsertionAcceptanceStatus = warm
    ? "warming"
    : counts.eligible > 0 && aggregateRate.rate >= INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD && apps.every((app) => app.passed)
      ? "pass"
      : "fail";

  return {
    status,
    counts,
    rates: { aggregate: aggregateRate, apps },
    apps,
    unknown,
  };
}

function makeRate(successful: number, eligible: number): InsertionAcceptanceRate {
  return {
    successful,
    eligible,
    rate: eligible === 0 ? 0 : successful / eligible,
  };
}
