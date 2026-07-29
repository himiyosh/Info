import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const assetIntegrityFile = "asset-integrity-contracts.test.mjs";
const expectedAssetIntegrityTestNames = [
  "all referenced local files exist",
  "preview assets are not stale or orphaned",
  "removed legacy particles file is not referenced",
  "hero image keeps an eager JPEG fallback and responsive assets match their descriptors"
];

test("asset integrity contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedAssetIntegrityTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(assetIntegrityFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedAssetIntegrityTestNames.map((testName) => [testName, 0])
      )
    },
    `${assetIntegrityFile} must exclusively own the four canonical asset integrity contracts`
  );
});
