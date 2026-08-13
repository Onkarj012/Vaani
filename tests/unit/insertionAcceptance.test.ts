import { describe, expect, it } from "vitest";
import type { DictationTrace, InjectionAttemptTrace } from "@shared/types";
import {
  INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD,
  INSERTION_ACCEPTANCE_APP_THRESHOLD,
  evaluateInsertionAcceptance,
} from "@shared/insertionAcceptance";

function trace(
  id: string,
  options: {
    buildIdentifier?: string | null;
    outcome?: DictationTrace["outcome"];
    action?: NonNullable<DictationTrace["qualityDecision"]>["action"];
    attempts?: InjectionAttemptTrace[];
  } = {},
): DictationTrace {
  return {
    id,
    sessionId: `session-${id}`,
    startedAt: "2026-08-06T00:00:00.000Z",
    ...(options.buildIdentifier === null ? {} : { buildIdentifier: options.buildIdentifier ?? "1.0.0+abc1234" }),
    targetAppBundleId: "com.example.Editor",
    targetAppName: "Editor",
    qualityDecision: options.action === undefined ? { action: "insert", reason: "usable" } : { action: options.action, reason: "test" },
    injectionAttempts: options.attempts ?? [successfulAttempt()],
    outcome: options.outcome ?? "injected",
  };
}

function successfulAttempt(
  targetAppBundleId: string | null = "com.example.Editor",
  targetAppName: string | null = "Editor",
): InjectionAttemptTrace {
  return {
    targetAppBundleId,
    targetAppName,
    method: "clipboard",
    success: true,
    verification: { readable: true, passed: true, repaired: false, reason: "expected-present" },
  };
}

function tracesFor(count: number, makeTrace: (index: number) => DictationTrace = (index) => trace(`trace-${index}`)): DictationTrace[] {
  return Array.from({ length: count }, (_, index) => makeTrace(index));
}

describe("evaluateInsertionAcceptance", () => {
  it("excludes absent and dirty build identifiers while retaining clean observations", () => {
    const result = evaluateInsertionAcceptance([
      trace("missing", { buildIdentifier: null }),
      trace("dirty", { buildIdentifier: "1.0.0+abc1234-dirty" }),
      trace("clean"),
    ]);

    expect(result.status).toBe("warming");
    expect(result.counts).toMatchObject({
      inspected: 3,
      qualifyingClean: 1,
      excluded: 2,
      excludedMissingBuildIdentifier: 1,
      excludedDirtyBuildIdentifier: 1,
      excludedInvalidBuildIdentifier: 0,
      excludedBaselineUnreadable: 0,
      eligible: 1,
      successful: 1,
      failed: 0,
    });
  });

  it("excludes unresolved and malformed committed identifiers", () => {
    const result = evaluateInsertionAcceptance([
      trace("unresolved", { buildIdentifier: "1.0.0+unresolved" }),
      trace("too-short", { buildIdentifier: "1.0.0+abc123" }),
      trace("non-hex", { buildIdentifier: "1.0.0+abc123g" }),
      trace("missing-plus", { buildIdentifier: "1.0.0-abc1234" }),
      trace("valid-40", { buildIdentifier: `1.0.0+${"a".repeat(40)}` }),
    ]);

    expect(result.counts).toMatchObject({
      inspected: 5,
      qualifyingClean: 1,
      excluded: 4,
      excludedMissingBuildIdentifier: 0,
      excludedDirtyBuildIdentifier: 0,
      excludedInvalidBuildIdentifier: 4,
      excludedBaselineUnreadable: 0,
      eligible: 1,
      successful: 1,
      failed: 0,
    });
  });

  it("stays warming when fewer than 200 stored slots are available", () => {
    const result = evaluateInsertionAcceptance(tracesFor(199));

    expect(result.status).toBe("warming");
    expect(result.counts.inspected).toBe(199);
  });

  it("excludes rejected observations from the eligible denominator", () => {
    const result = evaluateInsertionAcceptance([
      trace("rejected", { outcome: "rejected", action: "reject" }),
      trace("not-insert", { action: "save" }),
      trace("eligible"),
    ]);

    expect(result.counts).toMatchObject({ eligible: 1, successful: 1, failed: 0 });
  });

  it("counts a saved trace with an unsuccessful attempt as an eligible failure", () => {
    const result = evaluateInsertionAcceptance([trace("saved-failure", {
      outcome: "saved",
      attempts: [{ ...successfulAttempt(), success: false }],
    })]);

    expect(result.counts).toMatchObject({ eligible: 1, successful: 0, failed: 1 });
  });

  it("excludes baseline-unreadable attempts from the denominator and app buckets", () => {
    const result = evaluateInsertionAcceptance([
      trace("unassessable", {
        outcome: "saved",
        attempts: [{
          ...successfulAttempt(),
          verification: { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" },
        }],
      }),
      trace("eligible"),
    ]);

    expect(result.counts).toMatchObject({
      excluded: 1,
      excludedBaselineUnreadable: 1,
      eligible: 1,
      successful: 1,
      failed: 0,
    });
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0]).toMatchObject({ eligible: 1, successful: 1 });
  });

  it("keeps readable verification failures eligible", () => {
    const result = evaluateInsertionAcceptance([trace("readable-failure", {
      outcome: "saved",
      attempts: [{
        ...successfulAttempt(),
        verification: { readable: true, passed: false, repaired: false, reason: "missing" },
      }],
    })]);

    expect(result.counts).toMatchObject({
      excludedBaselineUnreadable: 0,
      eligible: 1,
      successful: 0,
      failed: 1,
    });
  });

  it("computes mixed success and failure rates without excluded baselines", () => {
    const result = evaluateInsertionAcceptance([
      trace("success"),
      trace("failure", { attempts: [{ ...successfulAttempt(), success: false }] }),
      trace("excluded", {
        outcome: "saved",
        attempts: [{
          ...successfulAttempt(),
          verification: { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" },
        }],
      }),
    ]);

    expect(result.counts).toMatchObject({ excluded: 1, excludedBaselineUnreadable: 1, eligible: 2, successful: 1, failed: 1 });
    expect(result.rates.aggregate).toEqual({ successful: 1, eligible: 2, rate: 0.5 });
    expect(result.apps[0]).toMatchObject({ eligible: 2, successful: 1, failed: 1, rate: 0.5 });
  });

  it("does not pass when every clean observation has an unreadable baseline", () => {
    const result = evaluateInsertionAcceptance(tracesFor(200, (index) => trace(`excluded-${index}`, {
      outcome: "saved",
      attempts: [{
        ...successfulAttempt(),
        verification: { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" },
      }],
    })));

    expect(result.status).toBe("fail");
    expect(result.counts).toMatchObject({
      inspected: 200,
      qualifyingClean: 200,
      excluded: 200,
      excludedBaselineUnreadable: 200,
      eligible: 0,
      successful: 0,
      failed: 0,
    });
    expect(result.apps).toHaveLength(0);
    expect(result.rates.aggregate.rate).toBe(0);
  });

  it("uses only the final injection attempt", () => {
    const result = evaluateInsertionAcceptance([trace("final-attempt", {
      attempts: [
        { ...successfulAttempt(), success: false },
        successfulAttempt(),
      ],
    })]);

    expect(result.counts).toMatchObject({ eligible: 1, successful: 1, failed: 0 });
  });

  it("reports null final targets in a non-binding unknown bucket", () => {
    const result = evaluateInsertionAcceptance([
      trace("unknown-success", { attempts: [successfulAttempt(null, null)] }),
      trace("unknown-failure", { attempts: [{ ...successfulAttempt(null, null), success: false }] }),
      trace("known-success"),
    ]);

    expect(result.apps).toHaveLength(1);
    expect(result.apps[0]?.targetAppBundleId).toBe("com.example.Editor");
    expect(result.unknown).toMatchObject({
      targetAppBundleId: "unknown",
      eligible: 2,
      successful: 1,
      failed: 1,
      rate: 0.5,
      bound: false,
      passed: true,
    });
  });

  it("requires readable and passed verification, including for AX", () => {
    const result = evaluateInsertionAcceptance([
      trace("ax-unverified", {
        attempts: [{
          ...successfulAttempt(),
          method: "ax",
          verification: { readable: true, passed: false, repaired: false, reason: "partial-unsafe" },
        }],
      }),
      trace("missing-verification", { attempts: [{ ...successfulAttempt(), verification: undefined }] }),
      trace("ax-repaired", {
        attempts: [{
          ...successfulAttempt(),
          method: "ax",
          verification: { readable: true, passed: true, repaired: true, reason: "partial-suffix-repaired" },
        }],
      }),
    ]);

    expect(result.counts).toMatchObject({ eligible: 3, successful: 1, failed: 2 });
  });

  it("exempts an app at nine observations and binds it at ten", () => {
    const exempt = evaluateInsertionAcceptance(tracesFor(9, (index) => trace(`exempt-${index}`, {
      attempts: [{ ...successfulAttempt("com.example.Exempt", "Exempt"), success: false }],
    })));
    const bound = evaluateInsertionAcceptance(tracesFor(10, (index) => trace(`bound-${index}`, {
      attempts: [{ ...successfulAttempt("com.example.Bound", "Bound"), success: false }],
    })));

    expect(exempt.apps[0]).toMatchObject({ targetAppBundleId: "com.example.Exempt", eligible: 9, bound: false, passed: true });
    expect(bound.apps[0]).toMatchObject({ targetAppBundleId: "com.example.Bound", eligible: 10, bound: true, passed: false });
  });

  it("passes exact aggregate and app thresholds, and fails one below either boundary", () => {
    const passing = evaluateInsertionAcceptance(tracesFor(200, (index) => {
      const app = index < 10 ? "com.example.Bound" : null;
      const successful = index >= 1 && index < 191;
      return trace(`pass-${index}`, {
        attempts: [{ ...successfulAttempt(app, app ? "Bound" : null), success: successful }],
      });
    }));
    const aggregateBelow = evaluateInsertionAcceptance(tracesFor(200, (index) => trace(`aggregate-${index}`, {
      attempts: [{ ...successfulAttempt(), success: index < 189 }],
    })));
    const appBelow = evaluateInsertionAcceptance(tracesFor(200, (index) => trace(`app-${index}`, {
      attempts: [{ ...successfulAttempt(index < 10 ? "com.example.Bound" : null, index < 10 ? "Bound" : null), success: index < 8 },
      ],
    })));

    expect(INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD).toBe(0.95);
    expect(INSERTION_ACCEPTANCE_APP_THRESHOLD).toBe(0.9);
    expect(passing.status).toBe("pass");
    expect(passing.rates.aggregate.rate).toBe(0.95);
    expect(passing.apps[0]).toMatchObject({ eligible: 10, successful: 9, rate: 0.9, bound: true, passed: true });
    expect(aggregateBelow.status).toBe("fail");
    expect(appBelow.status).toBe("fail");
    expect(appBelow.apps[0]).toMatchObject({ eligible: 10, successful: 8, bound: true, passed: false });
  });
});
