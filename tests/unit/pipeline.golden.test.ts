import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanupText, deterministicFormat } from "@main/text/cleanup";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";

interface PipelineCase {
  name: string;
  rawText: string;
  settingsOverrides: Partial<Settings>;
  expected: string;
  stage?: "cleanup" | "deterministicFormat";
  knownBug?: string;
}

type FixtureModule = PipelineCase[];

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/pipeline");
const fixtures = readdirSync(fixtureDirectory)
  .filter(file => file.endsWith(".json"))
  .sort()
  .map(file => ({
    file,
    fixtureCases: JSON.parse(readFileSync(resolve(fixtureDirectory, file), "utf8")) as FixtureModule,
  }));

const cases = fixtures.flatMap(({ file, fixtureCases }) => fixtureCases.map(testCase => ({ file, testCase })));

describe("deterministic text pipeline golden fixtures", () => {
  it("loads fixture cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const { file, testCase } of cases) {
    it(`${file}: ${testCase.name}`, () => {
      const actual = testCase.stage === "deterministicFormat"
        ? deterministicFormat(testCase.rawText)
        : cleanupText({
          rawText: testCase.rawText,
          settings: {
            ...DEFAULT_SETTINGS,
            ...testCase.settingsOverrides,
          },
        });

      expect(actual).toBe(testCase.expected);
    });
  }
});
