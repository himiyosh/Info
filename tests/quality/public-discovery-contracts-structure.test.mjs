import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const publicDiscoveryFile = "public-discovery-contracts.test.mjs";
const expectedPublicDiscoveryTestNames = [
  "required SEO and social metadata exist and are consistent",
  "static project summaries preserve canonical primary, source, proof, and fragment access",
  "JoJo deck entries stay distinct and aligned with live deck routes"
];

test("public discovery contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedPublicDiscoveryTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(publicDiscoveryFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedPublicDiscoveryTestNames.map((testName) => [testName, 0])
      )
    },
    `${publicDiscoveryFile} must exclusively own the three canonical public discovery contracts`
  );
});
