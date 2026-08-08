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
const baselineMotionSafetyFile = "baseline-motion-safety.test.mjs";
const mutationGuardFile =
  "baseline-motion-safety-structure-mutations.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY",
  "INFO_BASELINE_MOTION_SAFETY_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const baselineMotionSafetyExpectedBytes = 4_560;
const baselineMotionSafetyBodyStartExpectedBytes = 273;
const baselineMotionSafetyHeaderExpectedSha256 =
  "0e56555309f1cd482e5b0a071cf213f6859415387ac7983795e29915a1781fb3";
const baselineMotionSafetyBodyExpectedBytes = 4_287;
const baselineMotionSafetyBodyExpectedSha256 =
  "e6531007976b2dc661924aa27594b0eb99285f7c61198267fcc2c74bcd0285f3";
const mutationGuardExpectedBytes = 16_810;
const mutationGuardExpectedSha256 =
  "8621ec5ce1ca91e7283118ad1c9fabebbe7ea9d481bd85a363a2e2a8c965f86c";
const expectedBaselineMotionSafetyTestNames = [
  "hero image has no entrance animation and decorative keyframes are removed",
  "contact link hover transitions do not animate layout properties",
  "reveal targets stay visible by default and reveal machinery is bounded and safe"
];
const baselineMotionSafetyNamePattern =
  `^(?:${expectedBaselineMotionSafetyTestNames
    .map((testName) => testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})$`;
const requiredMutationTestNames = [
  "baseline motion safety structure guard accepts the reviewed unchanged extraction",
  "baseline motion safety structure guard rejects canonical names leaking into the monolith",
  "baseline motion safety structure guard rejects adjacent monolith contracts leaking into the focused module",
  "baseline motion safety structure guard rejects computed duplicate registrations",
  "baseline motion safety structure guard rejects dynamically assembled duplicate registrations",
  "baseline motion safety structure guard rejects hidden global duplicates",
  "baseline motion safety structure guard rejects skipped canonical contracts",
  "baseline motion safety structure guard rejects todo canonical contracts",
  "baseline motion safety structure guard rejects exclusive canonical contracts",
  "baseline motion safety structure guard rejects runtime-disabled canonical contracts",
  "baseline motion safety structure guard rejects focused-module padding",
  "baseline motion safety structure guard rejects monolith padding",
  "baseline motion safety structure guard rejects a same-length inert header wrapper",
  "baseline motion safety structure guard rejects empty stubs plus unrelated extraction",
  "baseline motion safety structure guard binds skipped mutation callbacks"
];
const adjacentMonolithTestNames = [
  "index.html IDs are unique and internal anchors are valid",
  "Japanese hero keeps each supplied phrase intact before the narrow emergency override"
];
const baselineMotionSafetyBodyStartMarker =
  `test(${JSON.stringify(expectedBaselineMotionSafetyTestNames[0])}`;
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
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      ...(only ? ["--test-only"] : []),
      ...(globalInventory
        ? [`--test-name-pattern=${baselineMotionSafetyNamePattern}`]
        : []),
      "--test-reporter=junit",
      ...files
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: childProcessEnv,
      timeout: qualitySpawnTimeoutMs
    }
  );

  assertQualitySpawnCompleted(result, "baseline motion-safety inventory");
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for baseline motion-safety inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runBaselineMotionSafetyTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", baselineMotionSafetyFile)],
    { only }
  );
}

function runGlobalBaselineMotionSafetyInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("baseline motion safety contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    baselineMotionSafetySource,
    baselineMotionSafetyStats,
    mutationGuardSource
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, baselineMotionSafetyFile), "utf8"),
    stat(path.join(qualityDirectory, baselineMotionSafetyFile)),
    readFile(path.join(qualityDirectory, mutationGuardFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const mutationTestNames = [
    ...mutationGuardSource.matchAll(/^mutationTest\(\n  "([^"]+)",/gm)
  ].map((match) => match[1]);
  const requiredMutationNameCounts = Object.fromEntries(
    requiredMutationTestNames.map((testName) => [
      testName,
      mutationTestNames.filter((name) => name === testName).length
    ])
  );
  assert.deepEqual(
    requiredMutationNameCounts,
    Object.fromEntries(
      requiredMutationTestNames.map((testName) => [testName, 1])
    ),
    `${mutationGuardFile} must register each required executable mutation exactly once`
  );
  const monolithCanonicalNameCounts = Object.fromEntries(
    expectedBaselineMotionSafetyTestNames.map((testName) => [
      testName,
      [...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))]
        .length
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(baselineMotionSafetyFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedBaselineMotionSafetyTestNames.map((testName) => [testName, 0])
      )
    },
    `${baselineMotionSafetyFile} must exclusively own the three canonical baseline motion-safety contracts`
  );

  const adjacentNameLocations = Object.fromEntries(
    adjacentMonolithTestNames.map((testName) => [
      testName,
      {
        focusedModuleCount: [
          ...baselineMotionSafetySource.matchAll(
            new RegExp(JSON.stringify(testName), "g")
          )
        ].length,
        monolithCount: [
          ...monolithSource.matchAll(
            new RegExp(JSON.stringify(testName), "g")
          )
        ].length
      }
    ])
  );
  assert.deepEqual(
    adjacentNameLocations,
    Object.fromEntries(
      adjacentMonolithTestNames.map((testName) => [
        testName,
        {
          focusedModuleCount: 0,
          monolithCount: 1
        }
      ])
    ),
    "the adjacent ID-anchor and Japanese-hero contracts must remain exclusively in the monolith"
  );

  const runtimeReport = runBaselineMotionSafetyTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedBaselineMotionSafetyTestNames,
    `${baselineMotionSafetyFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedBaselineMotionSafetyTestNames.length,
      suites: 0,
      pass: expectedBaselineMotionSafetyTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${baselineMotionSafetyFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runBaselineMotionSafetyTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", baselineMotionSafetyFile)],
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
    `${baselineMotionSafetyFile} must not register test.only or an only option`
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
    const globalReport =
      runGlobalBaselineMotionSafetyInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedBaselineMotionSafetyTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedBaselineMotionSafetyTestNames.map((testName) => [testName, 1])
      ),
      "canonical baseline motion-safety test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed baseline motion-safety extraction boundary`
  );
  assert.equal(
    baselineMotionSafetyStats.size,
    baselineMotionSafetyExpectedBytes,
    `${baselineMotionSafetyFile} must be exactly ${baselineMotionSafetyExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = baselineMotionSafetySource.indexOf(
    baselineMotionSafetyBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${baselineMotionSafetyFile} must retain the first baseline motion-safety test`
  );
  assert.equal(
    bodyStart,
    baselineMotionSafetySource.lastIndexOf(
      baselineMotionSafetyBodyStartMarker
    ),
    `${baselineMotionSafetyFile} must contain one unambiguous baseline motion-safety body start`
  );
  const baselineMotionSafetyHeader =
    baselineMotionSafetySource.slice(0, bodyStart);
  const baselineMotionSafetyBody =
    baselineMotionSafetySource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(baselineMotionSafetyHeader),
    baselineMotionSafetyBodyStartExpectedBytes,
    `${baselineMotionSafetyFile} assertion body must start at byte ${baselineMotionSafetyBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(baselineMotionSafetyHeader),
    baselineMotionSafetyHeaderExpectedSha256,
    `${baselineMotionSafetyFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(baselineMotionSafetyBody),
    baselineMotionSafetyBodyExpectedBytes,
    `${baselineMotionSafetyFile} assertion body must be exactly ${baselineMotionSafetyBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(baselineMotionSafetyBody),
    baselineMotionSafetyBodyExpectedSha256,
    `${baselineMotionSafetyFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
