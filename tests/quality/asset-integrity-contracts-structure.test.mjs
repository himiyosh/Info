import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { siteQualityExpectedBytes } from "../helpers/site-quality-boundary.mjs";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const helperDirectory = path.join(repoRoot, "tests/helpers");
const monolithFile = "site-quality.test.mjs";
const assetIntegrityFile = "asset-integrity-contracts.test.mjs";
const sharedHelperFile = "asset-reference-parsing.mjs";
const mutationGuardFile =
  "asset-integrity-contracts-structure-mutations.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const assetIntegrityExpectedBytes = 11_612;
const assetIntegrityBodyStartExpectedBytes = 5_148;
const assetIntegrityHeaderExpectedSha256 =
  "b808644d8c02c597f55989a041b5f10c822bb2a0076525a677b709eb8a605886";
const assetIntegrityBodyExpectedBytes = 6_464;
const assetIntegrityBodyExpectedSha256 =
  "42c6ff51c8e513fc12fa3d40f71bb22299c0f1081124689abc4fd3a52687abea";
const sharedHelperExpectedBytes = 457;
const sharedHelperExpectedSha256 =
  "6648599f751d88c67bbf4d481b5d1817260c13fcd030f521aa6ea1e71fcd6492";
const mutationGuardExpectedBytes = 13_086;
const mutationGuardExpectedSha256 =
  "9e52dd88a100f51880ee6a1a7e15396ea121db8110361a4384c0a3f61acb7bdb";
const expectedAssetIntegrityTestNames = [
  "all referenced local files exist",
  "preview assets are not stale or orphaned",
  "removed legacy particles file is not referenced",
  "hero image keeps an eager JPEG fallback and responsive assets match their descriptors"
];
const extractedHeroAnimationTestName =
  "hero image has no entrance animation and decorative keyframes are removed";
const assetIntegrityBodyStartMarker = `test(${JSON.stringify(expectedAssetIntegrityTestNames[0])}`;
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
    for (const environmentName of globalInventoryEnvironments) {
      childProcessEnv[environmentName] = globalInventoryEnvironmentValue;
    }
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
    `Quality test modules must execute successfully for asset integrity inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runAssetIntegrityTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", assetIntegrityFile)],
    { only }
  );
}

function runGlobalAssetIntegrityInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("asset integrity contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    assetIntegritySource,
    assetIntegrityStats,
    sharedHelperSource,
    sharedHelperStats,
    mutationGuardSource
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, assetIntegrityFile), "utf8"),
    stat(path.join(qualityDirectory, assetIntegrityFile)),
    readFile(path.join(helperDirectory, sharedHelperFile), "utf8"),
    stat(path.join(helperDirectory, sharedHelperFile)),
    readFile(path.join(qualityDirectory, mutationGuardFile), "utf8")
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

  assert.deepEqual(
    {
      monolithCount: [
        ...monolithSource.matchAll(
          new RegExp(JSON.stringify(extractedHeroAnimationTestName), "g")
        )
      ].length,
      focusedModuleCount: [
        ...assetIntegritySource.matchAll(
          new RegExp(JSON.stringify(extractedHeroAnimationTestName), "g")
        )
      ].length
    },
    {
      monolithCount: 0,
      focusedModuleCount: 0
    },
    "the extracted hero animation contract must remain outside the asset integrity module and monolith"
  );

  const runtimeReport = runAssetIntegrityTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedAssetIntegrityTestNames,
    `${assetIntegrityFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedAssetIntegrityTestNames.length,
      suites: 0,
      pass: expectedAssetIntegrityTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${assetIntegrityFile} must execute all four contracts without skip or todo`
  );

  const onlyReport = runAssetIntegrityTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", assetIntegrityFile)],
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
    `${assetIntegrityFile} must not register test.only or an only option`
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

  assert.equal(
    sharedHelperStats.size,
    sharedHelperExpectedBytes,
    `${sharedHelperFile} must be exactly ${sharedHelperExpectedBytes} bytes`
  );
  assert.equal(
    sha256(sharedHelperSource),
    sharedHelperExpectedSha256,
    `${sharedHelperFile} SHA-256 must match the reviewed shared parser implementation`
  );

  if (!globalInventoryChildMode) {
    const globalReport =
      runGlobalAssetIntegrityInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedAssetIntegrityTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedAssetIntegrityTestNames.map((testName) => [testName, 1])
      ),
      "canonical asset integrity test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed asset integrity extraction boundary`
  );
  assert.equal(
    assetIntegrityStats.size,
    assetIntegrityExpectedBytes,
    `${assetIntegrityFile} must be exactly ${assetIntegrityExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = assetIntegritySource.indexOf(
    assetIntegrityBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${assetIntegrityFile} must retain the first asset integrity test`
  );
  assert.equal(
    bodyStart,
    assetIntegritySource.lastIndexOf(assetIntegrityBodyStartMarker),
    `${assetIntegrityFile} must contain one unambiguous asset integrity body start`
  );
  const assetIntegrityHeader = assetIntegritySource.slice(0, bodyStart);
  const assetIntegrityBody = assetIntegritySource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(assetIntegrityHeader),
    assetIntegrityBodyStartExpectedBytes,
    `${assetIntegrityFile} assertion body must start at byte ${assetIntegrityBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(assetIntegrityHeader),
    assetIntegrityHeaderExpectedSha256,
    `${assetIntegrityFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(assetIntegrityBody),
    assetIntegrityBodyExpectedBytes,
    `${assetIntegrityFile} assertion body must be exactly ${assetIntegrityBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(assetIntegrityBody),
    assetIntegrityBodyExpectedSha256,
    `${assetIntegrityFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
