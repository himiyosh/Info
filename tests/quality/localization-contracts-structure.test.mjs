import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const localizationFile = "localization-contracts.test.mjs";
const expectedLocalizationTestNames = [
  "i18n key parity, references, and Japanese static fallbacks are complete",
  "Japanese running prose uses progressive phrase-aware line breaking",
  "protected Japanese phrase boundaries match between static and translated copy"
];

test("localization contracts live in one focused module", async () => {
  const [entries, monolithSource] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name);
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedLocalizationTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(localizationFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedLocalizationTestNames.map((testName) => [testName, 0])
      )
    },
    `${localizationFile} must exclusively own the three canonical localization contracts`
  );
});
