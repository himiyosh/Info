import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const publishingIntegrityFile = "publishing-integrity.test.mjs";
const expectedPublishingIntegrityTestNames = [
  "Pages artifact whitelist is strict and covers all locally referenced production files",
  "robots.txt and sitemap.xml are consistent"
];

test("publishing integrity contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name);
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedPublishingIntegrityTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(publishingIntegrityFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedPublishingIntegrityTestNames.map((testName) => [testName, 0])
      )
    },
    `${publishingIntegrityFile} must exclusively own the two canonical publishing integrity contracts`
  );
});
