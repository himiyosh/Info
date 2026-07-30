import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const reducedMotionFile = "reduced-motion-contracts.test.mjs";
const mutationGuardFile =
  "reduced-motion-contracts-structure-mutations.test.mjs";
const expectedReducedMotionTestNames = [
  "reduced motion nulls every new spatial transform, disables non-essential motion, and keeps the wordmark-mark rotation invariant",
  "reduced motion preference is live: a runtime change arms/disarms motion without duplicate observers"
];

test("reduced motion contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedReducedMotionTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))]
        .length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(reducedMotionFile),
      mutationGuardPresent: qualityTestFiles.includes(mutationGuardFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      mutationGuardPresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedReducedMotionTestNames.map((testName) => [testName, 0])
      )
    },
    `${reducedMotionFile} must exclusively own the two canonical reduced-motion contracts with executable mutation coverage`
  );
});
