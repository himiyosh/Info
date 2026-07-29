import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { siteQualityExpectedBytes } from "../helpers/site-quality-boundary.mjs";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const workflowSecurityFile = "workflow-security.test.mjs";
const workflowSecurityInventoryEnvironment = "INFO_WORKFLOW_SECURITY_INVENTORY";
const localizationInventoryEnvironment = "INFO_LOCALIZATION_INVENTORY";
const catalogueInventoryEnvironment = "INFO_PROJECT_CATALOGUE_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[workflowSecurityInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[localizationInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[catalogueInventoryEnvironment] === globalInventoryEnvironmentValue;
const workflowSecurityExpectedBytes = 5_051;
const workflowSecurityBodyStartExpectedBytes = 479;
const workflowSecurityBodyExpectedBytes = 4_572;
const workflowSecurityBodyExpectedSha256 =
  "08b0c5e432a84c57f900fee623a1903ec36f7daff0d99a665872986dc3d99c16";
const expectedWorkflowSecurityTestNames = [
  "workflow actions are pinned to immutable Node.js-24-compatible SHAs",
  "workflow checkouts do not persist credentials",
  "Pages workflow keeps least-privilege permissions and artifact-only deployment"
];
const workflowSecurityBodyStartMarker = `test(${JSON.stringify(expectedWorkflowSecurityTestNames[0])}`;
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
    `Quality test modules must execute successfully for workflow security inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runWorkflowSecurityTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", workflowSecurityFile)],
    { only }
  );
}

function runGlobalWorkflowSecurityInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("workflow security contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    workflowSecuritySource,
    workflowSecurityStats
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, workflowSecurityFile), "utf8"),
    stat(path.join(qualityDirectory, workflowSecurityFile))
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
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

  const runtimeReport = runWorkflowSecurityTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedWorkflowSecurityTestNames,
    `${workflowSecurityFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedWorkflowSecurityTestNames.length,
      suites: 0,
      pass: expectedWorkflowSecurityTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${workflowSecurityFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runWorkflowSecurityTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", workflowSecurityFile)],
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
    `${workflowSecurityFile} must not register test.only or an only option`
  );

  if (!globalInventoryChildMode) {
    const globalReport = runGlobalWorkflowSecurityInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedWorkflowSecurityTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedWorkflowSecurityTestNames.map((testName) => [testName, 1])
      ),
      "canonical workflow security test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed workflow security extraction boundary`
  );
  assert.equal(
    workflowSecurityStats.size,
    workflowSecurityExpectedBytes,
    `${workflowSecurityFile} must be exactly ${workflowSecurityExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = workflowSecuritySource.indexOf(workflowSecurityBodyStartMarker);
  assert.notEqual(
    bodyStart,
    -1,
    `${workflowSecurityFile} must retain the first workflow security test`
  );
  assert.equal(
    bodyStart,
    workflowSecuritySource.lastIndexOf(workflowSecurityBodyStartMarker),
    `${workflowSecurityFile} must contain one unambiguous workflow security body start`
  );
  const workflowSecurityHeader = workflowSecuritySource.slice(0, bodyStart);
  const workflowSecurityBody = workflowSecuritySource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(workflowSecurityHeader),
    workflowSecurityBodyStartExpectedBytes,
    `${workflowSecurityFile} assertion body must start at byte ${workflowSecurityBodyStartExpectedBytes}`
  );
  assert.equal(
    Buffer.byteLength(workflowSecurityBody),
    workflowSecurityBodyExpectedBytes,
    `${workflowSecurityFile} assertion body must be exactly ${workflowSecurityBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(workflowSecurityBody),
    workflowSecurityBodyExpectedSha256,
    `${workflowSecurityFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
