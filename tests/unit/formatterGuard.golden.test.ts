import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffContentWords } from "@shared/contentGuard";

interface GuardCase {
  name: string;
  raw: string;
  reply: string;
  passes: boolean;
  source?: string;
}

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/formatter");
const cases = readdirSync(fixtureDirectory)
  .filter(file => file.endsWith(".json"))
  .sort()
  .flatMap(file => (JSON.parse(readFileSync(resolve(fixtureDirectory, file), "utf8")) as GuardCase[]).map(testCase => ({ file, testCase })));

describe("formatter word guard golden fixtures", () => {
  it("loads fixture cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { file, testCase } of cases) {
    it(`${file}: ${testCase.name}`, () => {
      const diff = diffContentWords(testCase.raw, testCase.reply, ["um", "uh"]);
      const passed = !diff.rejection && diff.missing.length === 0 && diff.added.length === 0;
      expect({ passed, diff }).toMatchObject({ passed: testCase.passes });
    });
  }
});
