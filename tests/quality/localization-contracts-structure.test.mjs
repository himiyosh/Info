import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const localizationFile = "localization-contracts.test.mjs";
const localizationInventoryEnvironment = "INFO_LOCALIZATION_INVENTORY";
const catalogueInventoryEnvironment = "INFO_PROJECT_CATALOGUE_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[localizationInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[catalogueInventoryEnvironment] === globalInventoryEnvironmentValue;
const monolithExpectedBytes = 70_590;
const localizationExpectedBytes = 10_298;
const localizationBodyStartExpectedBytes = 5_836;
const localizationBodyExpectedBytes = 4_462;
const localizationBodyExpectedSha256 =
  "a32ad8d4991b567ce917e51d25b12ed2b0b96e46cfec8ab7812475406cab8987";
const expectedLocalizationTestNames = [
  "i18n key parity, references, and Japanese static fallbacks are complete",
  "Japanese running prose uses progressive phrase-aware line breaking",
  "protected Japanese phrase boundaries match between static and translated copy"
];
const localizationBodyStartMarker = `test(${JSON.stringify(expectedLocalizationTestNames[0])}`;
const junitSummaryKeys = [
  "tests",
  "suites",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo"
];

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function decodeXmlAttribute(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseJunitReport(source) {
  const names = [...source.matchAll(/<testcase\b[^>]*\bname="([^"]*)"/g)].map(
    (match) => decodeXmlAttribute(match[1])
  );
  const summary = Object.fromEntries(
    junitSummaryKeys.map((key) => {
      const match = source.match(new RegExp(`<!-- ${key} (\\d+) -->`));
      assert.ok(match, `JUnit report must include the ${key} summary`);
      return [key, Number(match[1])];
    })
  );
  return { names, summary };
}

function runTestModules(
  files,
  { globalInventory = false, only = false } = {}
) {
  const childProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete childProcessEnv.NODE_TEST_CONTEXT;
  if (globalInventory) {
    childProcessEnv[localizationInventoryEnvironment] =
      globalInventoryEnvironmentValue;
    childProcessEnv[catalogueInventoryEnvironment] =
      globalInventoryEnvironmentValue;
  }
  const args = [
    "--test",
    ...(only ? ["--test-only"] : []),
    "--test-reporter=junit",
    ...files
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: childProcessEnv,
    timeout: 60_000
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for localization inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runLocalizationTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", localizationFile)],
    { only }
  );
}

function runGlobalLocalizationInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("localization contracts live in one focused module", async () => {
  const [
    entries,
    localizationSource,
    localizationStats,
    monolithSource,
    monolithStats
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, localizationFile), "utf8"),
    stat(path.join(qualityDirectory, localizationFile)),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile))
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  assert.ok(
    qualityTestFiles.includes(localizationFile),
    `${localizationFile} must own the fixed localization quality contracts`
  );

  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedLocalizationTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))].length
    ])
  );

  assert.deepEqual(
    monolithCanonicalNameCounts,
    Object.fromEntries(
      expectedLocalizationTestNames.map((testName) => [testName, 0])
    ),
    `${monolithFile} must no longer register the canonical localization contracts`
  );

  const runtimeReport = runLocalizationTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedLocalizationTestNames,
    `${localizationFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedLocalizationTestNames.length,
      suites: 0,
      pass: expectedLocalizationTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${localizationFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runLocalizationTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", localizationFile)],
      summary: {
        tests: 1,
        suites: 0,
        pass: 1,
        fail: 0,
        cancelled: 0,
        skipped: 0,
        todo: 0
      }
    },
    `${localizationFile} must not register test.only or an only option`
  );

  if (!globalInventoryChildMode) {
    const globalReport = runGlobalLocalizationInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedLocalizationTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedLocalizationTestNames.map((testName) => [testName, 1])
      ),
      "canonical localization test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    monolithExpectedBytes,
    `${monolithFile} must be exactly ${monolithExpectedBytes} bytes at the reviewed localization extraction boundary`
  );
  assert.equal(
    localizationStats.size,
    localizationExpectedBytes,
    `${localizationFile} must be exactly ${localizationExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = localizationSource.indexOf(localizationBodyStartMarker);
  assert.notEqual(
    bodyStart,
    -1,
    `${localizationFile} must retain the first localization test`
  );
  assert.equal(
    bodyStart,
    localizationSource.lastIndexOf(localizationBodyStartMarker),
    `${localizationFile} must contain one unambiguous localization body start`
  );
  const localizationHeader = localizationSource.slice(0, bodyStart);
  const localizationBody = localizationSource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(localizationHeader),
    localizationBodyStartExpectedBytes,
    `${localizationFile} assertion body must start at byte ${localizationBodyStartExpectedBytes}`
  );
  assert.equal(
    Buffer.byteLength(localizationBody),
    localizationBodyExpectedBytes,
    `${localizationFile} assertion body must be exactly ${localizationBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(localizationBody),
    localizationBodyExpectedSha256,
    `${localizationFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
