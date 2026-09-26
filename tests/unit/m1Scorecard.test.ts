import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("M1 scorecard script", () => {
  it("preserves owner labels and old sessions without exporting transcript text", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-scorecard-"));
    const input = join(tempDir, "traces.json");
    const output = join(tempDir, "scorecard.csv");
    const script = resolve("scripts/m1-scorecard.mjs");
    const secret = "private transcript sentinel";
    const first = {
      id: "trace-1", sessionId: "session-1", startedAt: "2026-09-26T00:00:00.000Z",
      targetAppName: "TextEdit", rawAudio: { durationSeconds: 2 }, outcome: "injected",
      stopRequestedAt: "2026-09-26T00:00:01.000Z",
      lastFrameAfterStopMs: 280, trailingRms: 0.012,
      clipReadyAt: "2026-09-26T00:00:01.300Z",
      sttDoneAt: "2026-09-26T00:00:01.900Z",
      formatDoneAt: "2026-09-26T00:00:02.100Z",
      dispatchAt: "2026-09-26T00:00:02.300Z",
      verifyDoneAt: "2026-09-26T00:00:02.500Z",
      completedAt: "2026-09-26T00:00:02.600Z",
      stages: { rawTranscript: secret, cleanedText: secret }, userMessage: secret,
    };
    await writeFile(input, JSON.stringify([first]));
    const firstSummary = execFileSync("node", [script, "--input", input, "--output", output], { encoding: "utf8" });
    expect(firstSummary).toContain("stop_to_clip_ms: p50=300ms p90=300ms");
    expect(firstSummary).not.toContain(secret);
    const initialCsv = await readFile(output, "utf8");
    expect(initialCsv).not.toContain(secret);
    expect(initialCsv).toContain("session-1,2026-09-26T00:00:00.000Z,TextEdit,<3s,injected,Inserted,300,600,200,200,200,100,1600,280,0.012,,,");

    await writeFile(output, initialCsv.replace(/,,,\n$/, ',y,n,"note, kept"\n'));
    await writeFile(input, JSON.stringify([{
      id: "trace-2", sessionId: "session-2", startedAt: "2026-09-26T01:00:00.000Z", targetAppName: "Ghostty",
      outcome: "failed", rejectionReason: "timeout", userMessage: secret,
    }]));
    const secondSummary = execFileSync("node", [script, "--input", input, "--output", output], { encoding: "utf8" });
    const finalCsv = await readFile(output, "utf8");
    expect(finalCsv).toContain('session-1,2026-09-26T00:00:00.000Z,TextEdit,<3s,injected,Inserted,300,600,200,200,200,100,1600,280,0.012,y,n,"note, kept"');
    expect(finalCsv).toContain("session-2,2026-09-26T01:00:00.000Z,Ghostty,unknown,failed,Timed out");
    expect(secondSummary).toContain("Per-app failures: Ghostty=1");
    expect(secondSummary).toContain("Sessions: 2; outcomes: injected=1, failed=1");
    expect(secondSummary).toContain("stop_to_clip_ms: p50=300ms p90=300ms (n=1)");
    expect(finalCsv).not.toContain(secret);
    expect(secondSummary).not.toContain(secret);
  });
});
