import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const mobileNavigationFile = "mobile-navigation-contracts.test.mjs";
const expectedMobileNavigationTestNames = [
  "mobile navigation enhancement is progressive and keeps no-JS links usable",
  "open mobile navigation wraps keyboard focus at its disclosure boundaries",
  "modern mobile navigation stays scroll-contained in short safe-area viewports"
];

test("mobile navigation contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name);
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedMobileNavigationTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(mobileNavigationFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedMobileNavigationTestNames.map((testName) => [testName, 0])
      )
    },
    `${mobileNavigationFile} must exclusively own the three canonical mobile navigation contracts`
  );
});
