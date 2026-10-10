import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("M1 scorecard script", () => {
  it("uses controlled outcome and status labels for new and unknown trace schemas", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-scorecard-"));
    const input = join(tempDir, "traces.json");
    const output = join(tempDir, "scorecard.csv");
    const secret = "private transcript sentinel";
    await writeFile(input, JSON.stringify([
      { id: "one", sessionId: "one", startedAt: "2026-09-26T00:00:00.000Z", outcome: "unconfirmed", userMessage: "Insertion unconfirmed. Check the field before pasting again.", stages: { cleanedText: secret } },
      { id: "two", sessionId: "two", startedAt: "2026-09-26T00:00:00.000Z", outcome: secret, userMessage: secret },
    ]));

    const summary = execFileSync("node", [resolve("scripts/m1-scorecard.mjs"), "--input", input, "--output", output], { encoding: "utf8" });
    const csv = await readFile(output, "utf8");
    expect(csv).toContain("unconfirmed,Insertion unconfirmed. Check the field before pasting again.");
    expect(csv).toContain("unknown,Failed");
    expect(csv).not.toContain(secret);
    expect(summary).not.toContain(secret);
  });

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
      lastFrameAfterStopMs: 280, trailingRms: 0.012, buildIdentifier: "1.2.0+4ecf863",
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
    expect(initialCsv).toContain("session-1,2026-09-26T00:00:00.000Z,TextEdit,<3s,injected,Inserted,300,600,200,200,200,100,1600,280,0.012,1.2.0+4ecf863,,,");

    await writeFile(output, initialCsv.replace(/,,,\n$/, ',y,n,"note, kept"\n'));
    await writeFile(input, JSON.stringify([{
      id: "trace-2", sessionId: "session-2", startedAt: "2026-09-26T01:00:00.000Z", targetAppName: "Ghostty",
      outcome: "failed", rejectionReason: "timeout", userMessage: secret,
    }]));
    const secondSummary = execFileSync("node", [script, "--input", input, "--output", output], { encoding: "utf8" });
    const finalCsv = await readFile(output, "utf8");
    expect(finalCsv).toContain('session-1,2026-09-26T00:00:00.000Z,TextEdit,<3s,injected,Inserted,300,600,200,200,200,100,1600,280,0.012,1.2.0+4ecf863,y,n,"note, kept"');
    expect(finalCsv).toContain("session-2,2026-09-26T01:00:00.000Z,Ghostty,unknown,failed,Timed out");
    expect(secondSummary).toContain("Per-app failures: Ghostty=1");
    expect(secondSummary).toContain("Sessions: 2; outcomes: injected=1, failed=1");
    expect(secondSummary).toContain("stop_to_clip_ms: p50=300ms p90=300ms (n=1)");
    expect(finalCsv).not.toContain(secret);
    expect(secondSummary).not.toContain(secret);
  });

  it("neutralizes formula prefixes in app names", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-scorecard-"));
    const input = join(tempDir, "traces.json");
    const output = join(tempDir, "scorecard.csv");
    const script = resolve("scripts/m1-scorecard.mjs");
    await writeFile(input, JSON.stringify(["=1+1", "+SUM(1)", "-2+3", "@SUM(1)", "\t=1+1", "\r=1+1"].map((name, index) => ({
      sessionId: `session-${index}`, targetAppName: name, outcome: "failed",
    }))));
    execFileSync("node", [script, "--input", input, "--output", output]);
    const csv = await readFile(output, "utf8");
    for (const prefix of ["=1+1", "+SUM(1)", "-2+3", "@SUM(1)", "\t=1+1", "\r=1+1"]) {
      expect(csv).toContain(`'${prefix}`);
    }
  });

  it("replaces the output by rename and preserves owner labels if temp writing fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-scorecard-"));
    const input = join(tempDir, "traces.json");
    const output = join(tempDir, "scorecard.csv");
    const script = resolve("scripts/m1-scorecard.mjs");
    await writeFile(input, JSON.stringify([{ sessionId: "session-1", outcome: "failed" }]));
    execFileSync("node", [script, "--input", input, "--output", output]);
    const original = await readFile(output, "utf8");
    const originalInode = (await stat(output)).ino;
    await writeFile(output, original.replace(/,,,\n$/, ",y,n,owner note\n"));
    const ownerCsv = await readFile(output, "utf8");
    execFileSync("node", [script, "--input", input, "--output", output]);
    expect((await stat(output)).ino).not.toBe(originalInode);

    await chmod(tempDir, 0o500);
    try {
      expect(() => execFileSync("node", [script, "--input", input, "--output", output], { stdio: "ignore" })).toThrow();
      expect(await readFile(output, "utf8")).toBe(ownerCsv);
    } finally {
      await chmod(tempDir, 0o700);
    }
  });
});
