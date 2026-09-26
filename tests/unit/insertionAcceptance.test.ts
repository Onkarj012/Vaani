import { describe, expect, it } from "vitest";
import type { DictationTrace, InjectionAttemptTrace } from "@shared/types";
import {
  INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD,
  INSERTION_ACCEPTANCE_APP_THRESHOLD,
  INSERTION_ACCEPTANCE_APP_BINDING_COUNT,
  INSERTION_ACCEPTANCE_MIN_TRIALS,
  INSERTION_ACCEPTANCE_REQUIRED_CLASSES,
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

  it("stays warming until the minimum 100 eligible trials are available", () => {
    const result = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS - 1));

    expect(result.status).toBe("warming");
    expect(result.counts.inspected).toBe(INSERTION_ACCEPTANCE_MIN_TRIALS - 1);
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

  it("counts new verified and unconfirmed outcomes in the existing insertion metric", () => {
    const result = evaluateInsertionAcceptance([
      trace("verified", { outcome: "verified" }),
      trace("unconfirmed", { outcome: "unconfirmed", attempts: [{ ...successfulAttempt(), verification: { readable: true, passed: false, repaired: false, reason: "timeout" } }] }),
      trace("copy-only", { outcome: "copy-only", attempts: [] }),
    ]);

    expect(result.counts).toMatchObject({ eligible: 2, successful: 1, failed: 1 });
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
    const result = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS, (index) => trace(`excluded-${index}`, {
      outcome: "saved",
      attempts: [{
        ...successfulAttempt(),
        verification: { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" },
      }],
    })));

    expect(result.status).toBe("fail");
    expect(result.counts).toMatchObject({
      inspected: INSERTION_ACCEPTANCE_MIN_TRIALS,
      qualifyingClean: INSERTION_ACCEPTANCE_MIN_TRIALS,
      excluded: INSERTION_ACCEPTANCE_MIN_TRIALS,
      excludedBaselineUnreadable: INSERTION_ACCEPTANCE_MIN_TRIALS,
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

  it("does not bind an app at 99 trials and binds it at 100", () => {
    const exempt = evaluateInsertionAcceptance(tracesFor(99, (index) => trace(`exempt-${index}`, {
      attempts: [{ ...successfulAttempt("com.example.Exempt", "Exempt"), success: false }],
    })));
    const bound = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_APP_BINDING_COUNT, (index) => trace(`bound-${index}`, {
      attempts: [{ ...successfulAttempt("com.example.Bound", "Bound"), success: false }],
    })));

    expect(exempt.apps[0]).toMatchObject({ targetAppBundleId: "com.example.Exempt", eligible: 99, bound: false, passed: true });
    expect(bound.apps[0]).toMatchObject({ targetAppBundleId: "com.example.Bound", eligible: 100, bound: true, passed: false });
  });

  it("uses synthetic fixtures for exact aggregate and app thresholds", () => {
    const passing = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS, (index) => {
      const app = index < 100 ? "com.example.Bound" : null;
      const successful = index < 98;
      return trace(`pass-${index}`, {
        attempts: [{ ...successfulAttempt(app, app ? "Bound" : null), targetFieldClass: `field-${index % 20}`, success: successful }],
      });
    }));
    const aggregateBelow = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS, (index) => trace(`aggregate-${index}`, {
      attempts: [{ ...successfulAttempt(), targetFieldClass: `field-${index % 20}`, success: index < 97 }],
    })));
    const appBelow = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS, (index) => trace(`app-${index}`, {
      attempts: [{ ...successfulAttempt(index < 100 ? "com.example.Bound" : null, index < 100 ? "Bound" : null), targetFieldClass: `field-${index % 20}`, success: index < 100 ? index < 94 : true },
      ],
    })));

    expect(INSERTION_ACCEPTANCE_AGGREGATE_THRESHOLD).toBe(0.98);
    expect(INSERTION_ACCEPTANCE_APP_THRESHOLD).toBe(0.95);
    expect(passing.status).toBe("pass");
    expect(passing.rates.aggregate.rate).toBe(0.98);
    expect(passing.apps[0]).toMatchObject({ eligible: 100, successful: 98, rate: 0.98, bound: true, passed: true });
    expect(aggregateBelow.status).toBe("fail");
    expect(appBelow.status).toBe("fail");
    expect(appBelow.apps[0]).toMatchObject({ eligible: 100, successful: 94, rate: 0.94, bound: true, passed: false });
  });

  it("represents the required twenty deterministic app and field classes", () => {
    const classes = [
      "native-single-line", "native-multiline", "native-rich-text", "native-password", "native-search",
      "browser-single-line", "browser-multiline", "browser-rich-text", "browser-composer", "browser-search",
      "terminal-shell", "terminal-editor", "chat-composer", "chat-thread", "mail-body",
      "document-body", "spreadsheet-cell", "code-editor", "note-body", "dialog-input",
    ];
    const result = evaluateInsertionAcceptance(tracesFor(INSERTION_ACCEPTANCE_MIN_TRIALS, (index) => trace(`matrix-${index}`, {
      attempts: [{ ...successfulAttempt(`com.example.Matrix${index % classes.length}`, "Matrix"), targetFieldClass: classes[index % classes.length] }],
    })));
    expect(result.representedClasses).toHaveLength(INSERTION_ACCEPTANCE_REQUIRED_CLASSES);
    expect(result.status).toBe("pass");
  });
});
