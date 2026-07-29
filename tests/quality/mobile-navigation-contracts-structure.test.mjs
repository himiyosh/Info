import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const mutationGuardFile =
  "mobile-navigation-contracts-structure-mutations.test.mjs";
const mobileNavigationFile = "mobile-navigation-contracts.test.mjs";
const workflowSecurityInventoryEnvironment = "INFO_WORKFLOW_SECURITY_INVENTORY";
const localizationInventoryEnvironment = "INFO_LOCALIZATION_INVENTORY";
const catalogueInventoryEnvironment = "INFO_PROJECT_CATALOGUE_INVENTORY";
const publishingIntegrityInventoryEnvironment = "INFO_PUBLISHING_INTEGRITY_INVENTORY";
const mobileNavigationInventoryEnvironment = "INFO_MOBILE_NAVIGATION_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[workflowSecurityInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[localizationInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[catalogueInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[publishingIntegrityInventoryEnvironment] ===
    globalInventoryEnvironmentValue ||
  process.env[mobileNavigationInventoryEnvironment] ===
    globalInventoryEnvironmentValue;
const monolithExpectedBytes = 43_522;
const mutationGuardExpectedBytes = 6_616;
const mutationGuardExpectedSha256 =
  "f11d9742929828c4711e29fc9b79179cd42d810f7b530142c8fdc722a3736936";
const mobileNavigationExpectedBytes = 6_211;
const mobileNavigationBodyStartExpectedBytes = 273;
const mobileNavigationHeaderExpectedSha256 =
  "0e56555309f1cd482e5b0a071cf213f6859415387ac7983795e29915a1781fb3";
const mobileNavigationBodyExpectedBytes = 5_938;
const mobileNavigationBodyExpectedSha256 =
  "228bade1b831e0c6d50a4a656b5ec3f73bf4744f8618b91e4fe540d91129491e";
const expectedMobileNavigationTestNames = [
  "mobile navigation enhancement is progressive and keeps no-JS links usable",
  "open mobile navigation wraps keyboard focus at its disclosure boundaries",
  "modern mobile navigation stays scroll-contained in short safe-area viewports"
];
const mobileNavigationBodyStartMarker = `test(${JSON.stringify(expectedMobileNavigationTestNames[0])}`;
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
    childProcessEnv[mobileNavigationInventoryEnvironment] =
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
    `Quality test modules must execute successfully for mobile navigation inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runMobileNavigationTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", mobileNavigationFile)],
    { only }
  );
}

function runGlobalMobileNavigationInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("mobile navigation contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    mutationGuardSource,
    mobileNavigationSource,
    mobileNavigationStats
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
    readFile(path.join(qualityDirectory, mobileNavigationFile), "utf8"),
    stat(path.join(qualityDirectory, mobileNavigationFile))
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
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

  const runtimeReport = runMobileNavigationTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedMobileNavigationTestNames,
    `${mobileNavigationFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedMobileNavigationTestNames.length,
      suites: 0,
      pass: expectedMobileNavigationTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${mobileNavigationFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runMobileNavigationTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", mobileNavigationFile)],
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
    `${mobileNavigationFile} must not register test.only or an only option`
  );

  assert.equal(
    sha256(mutationGuardSource),
    mutationGuardExpectedSha256,
    `${mutationGuardFile} mutation guard source SHA-256 must match the reviewed fixture`
  );
  assert.equal(
    Buffer.byteLength(mutationGuardSource),
    mutationGuardExpectedBytes,
    `${mutationGuardFile} must be exactly ${mutationGuardExpectedBytes} bytes`
  );

  if (!globalInventoryChildMode) {
    const globalReport = runGlobalMobileNavigationInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedMobileNavigationTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedMobileNavigationTestNames.map((testName) => [testName, 1])
      ),
      "canonical mobile navigation test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    monolithExpectedBytes,
    `${monolithFile} must be exactly ${monolithExpectedBytes} bytes at the reviewed mobile navigation extraction boundary`
  );
  assert.equal(
    mobileNavigationStats.size,
    mobileNavigationExpectedBytes,
    `${mobileNavigationFile} must be exactly ${mobileNavigationExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = mobileNavigationSource.indexOf(
    mobileNavigationBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${mobileNavigationFile} must retain the first mobile navigation test`
  );
  assert.equal(
    bodyStart,
    mobileNavigationSource.lastIndexOf(mobileNavigationBodyStartMarker),
    `${mobileNavigationFile} must contain one unambiguous mobile navigation body start`
  );
  const mobileNavigationHeader = mobileNavigationSource.slice(0, bodyStart);
  const mobileNavigationBody = mobileNavigationSource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(mobileNavigationHeader),
    mobileNavigationBodyStartExpectedBytes,
    `${mobileNavigationFile} assertion body must start at byte ${mobileNavigationBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(mobileNavigationHeader),
    mobileNavigationHeaderExpectedSha256,
    `${mobileNavigationFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(mobileNavigationBody),
    mobileNavigationBodyExpectedBytes,
    `${mobileNavigationFile} assertion body must be exactly ${mobileNavigationBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(mobileNavigationBody),
    mobileNavigationBodyExpectedSha256,
    `${mobileNavigationFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
