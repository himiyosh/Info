import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const baselineMotionSafetyFile = "baseline-motion-safety.test.mjs";
const mutationGuardFile =
  "baseline-motion-safety-structure-mutations.test.mjs";
const expectedBaselineMotionSafetyTestNames = [
  "hero image has no entrance animation and decorative keyframes are removed",
  "contact link hover transitions do not animate layout properties",
  "project rows stay visible by default and reveal machinery is bounded and safe"
];

test("baseline motion safety contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name);
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedBaselineMotionSafetyTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))]
        .length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(baselineMotionSafetyFile),
      mutationGuardPresent: qualityTestFiles.includes(mutationGuardFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      mutationGuardPresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedBaselineMotionSafetyTestNames.map((testName) => [testName, 0])
      )
    },
    "the focused module and mutation guard must exclusively own the three canonical baseline motion-safety contracts"
  );
});
