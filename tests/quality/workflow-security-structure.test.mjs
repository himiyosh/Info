import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const workflowSecurityFile = "workflow-security.test.mjs";
const expectedWorkflowSecurityTestNames = [
  "workflow actions are pinned to immutable Node.js-24-compatible SHAs",
  "workflow checkouts do not persist credentials",
  "Pages workflow keeps least-privilege permissions and artifact-only deployment"
];

test("workflow security contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name);
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedWorkflowSecurityTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(workflowSecurityFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedWorkflowSecurityTestNames.map((testName) => [testName, 0])
      )
    },
    `${workflowSecurityFile} must exclusively own the three canonical workflow security contracts`
  );
});
