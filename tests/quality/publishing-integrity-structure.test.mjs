import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  assertQualitySpawnCompleted,
  qualitySpawnTimeoutMs
} from "../helpers/quality-spawn.mjs";
import { siteQualityExpectedBytes } from "../helpers/site-quality-boundary.mjs";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const publishingIntegrityFile = "publishing-integrity.test.mjs";
const workflowSecurityInventoryEnvironment = "INFO_WORKFLOW_SECURITY_INVENTORY";
const localizationInventoryEnvironment = "INFO_LOCALIZATION_INVENTORY";
const catalogueInventoryEnvironment = "INFO_PROJECT_CATALOGUE_INVENTORY";
const publishingIntegrityInventoryEnvironment = "INFO_PUBLISHING_INTEGRITY_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[workflowSecurityInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[localizationInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[catalogueInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[publishingIntegrityInventoryEnvironment] ===
    globalInventoryEnvironmentValue;
const publishingIntegrityExpectedBytes = 4_501;
const publishingIntegrityBodyStartExpectedBytes = 1_113;
const publishingIntegrityBodyExpectedBytes = 3_388;
const publishingIntegrityBodyExpectedSha256 =
  "2ea9dcf388a3b7b730a30b3d5ddce7c55bd1734dc83b61a6324083a7dcdd346d";
const expectedPublishingIntegrityTestNames = [
  "Pages artifact whitelist is strict and covers all locally referenced production files",
  "robots.txt and sitemap.xml are consistent"
];
const publishingIntegrityBodyStartMarker = `test(${JSON.stringify(expectedPublishingIntegrityTestNames[0])}`;
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
    childProcessEnv[workflowSecurityInventoryEnvironment] =
      globalInventoryEnvironmentValue;
    childProcessEnv[localizationInventoryEnvironment] =
      globalInventoryEnvironmentValue;
    childProcessEnv[catalogueInventoryEnvironment] =
      globalInventoryEnvironmentValue;
    childProcessEnv[publishingIntegrityInventoryEnvironment] =
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
    timeout: qualitySpawnTimeoutMs
  });

  assertQualitySpawnCompleted(result, "publishing integrity inventory");
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for publishing integrity inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runPublishingIntegrityTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", publishingIntegrityFile)],
    { only }
  );
}

function runGlobalPublishingIntegrityInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("publishing integrity contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    publishingIntegritySource,
    publishingIntegrityStats
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, publishingIntegrityFile), "utf8"),
    stat(path.join(qualityDirectory, publishingIntegrityFile))
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
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

  const runtimeReport = runPublishingIntegrityTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedPublishingIntegrityTestNames,
    `${publishingIntegrityFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedPublishingIntegrityTestNames.length,
      suites: 0,
      pass: expectedPublishingIntegrityTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${publishingIntegrityFile} must execute both contracts without skip or todo`
  );

  const onlyReport = runPublishingIntegrityTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", publishingIntegrityFile)],
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
    `${publishingIntegrityFile} must not register test.only or an only option`
  );

  if (!globalInventoryChildMode) {
    const globalReport = runGlobalPublishingIntegrityInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedPublishingIntegrityTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedPublishingIntegrityTestNames.map((testName) => [testName, 1])
      ),
      "canonical publishing integrity test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed publishing integrity extraction boundary`
  );
  assert.equal(
    publishingIntegrityStats.size,
    publishingIntegrityExpectedBytes,
    `${publishingIntegrityFile} must be exactly ${publishingIntegrityExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = publishingIntegritySource.indexOf(
    publishingIntegrityBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${publishingIntegrityFile} must retain the first publishing integrity test`
  );
  assert.equal(
    bodyStart,
    publishingIntegritySource.lastIndexOf(publishingIntegrityBodyStartMarker),
    `${publishingIntegrityFile} must contain one unambiguous publishing integrity body start`
  );
  const publishingIntegrityHeader = publishingIntegritySource.slice(0, bodyStart);
  const publishingIntegrityBody = publishingIntegritySource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(publishingIntegrityHeader),
    publishingIntegrityBodyStartExpectedBytes,
    `${publishingIntegrityFile} assertion body must start at byte ${publishingIntegrityBodyStartExpectedBytes}`
  );
  assert.equal(
    Buffer.byteLength(publishingIntegrityBody),
    publishingIntegrityBodyExpectedBytes,
    `${publishingIntegrityFile} assertion body must be exactly ${publishingIntegrityBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(publishingIntegrityBody),
    publishingIntegrityBodyExpectedSha256,
    `${publishingIntegrityFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
