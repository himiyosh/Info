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
const publicDiscoveryFile = "public-discovery-contracts.test.mjs";
const mutationGuardFile =
  "public-discovery-contracts-structure-mutations.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const publicDiscoveryExpectedBytes = 4_993;
const publicDiscoveryBodyStartExpectedBytes = 273;
const publicDiscoveryHeaderExpectedSha256 =
  "0e56555309f1cd482e5b0a071cf213f6859415387ac7983795e29915a1781fb3";
const publicDiscoveryBodyExpectedBytes = 4_720;
const publicDiscoveryBodyExpectedSha256 =
  "c29e8f3a93bff0d813f57d1d36072bcca00d78cd3a8ad1a93a0c41726ac9f802";
const mutationGuardExpectedBytes = 15_985;
const mutationGuardExpectedSha256 =
  "dd1560dd84d6cc728c2a3700aa7f5ea1fa82084fe911407d20146b1d199eae86";
const expectedPublicDiscoveryTestNames = [
  "required SEO and social metadata exist and are consistent",
  "static project summaries preserve canonical primary, source, proof, and fragment access",
  "JoJo deck entries stay distinct and aligned with live deck routes"
];
const requiredOwnershipMutationTestNames = [
  "public discovery structure guard rejects canonical names leaking into the monolith",
  "public discovery structure guard rejects adjacent monolith contracts leaking into the focused module"
];
const adjacentMonolithTestNames = [
  "JavaScript files are parseable",
  "rejected continuous curiosity field recovery remains absent",
  "new-tab links include bilingual accessibility announcement text"
];
const publicDiscoveryBodyStartMarker = `test(${JSON.stringify(expectedPublicDiscoveryTestNames[0])}`;
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
    timeout: qualitySpawnTimeoutMs
  });

  assertQualitySpawnCompleted(result, "public discovery inventory");
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for public discovery inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runPublicDiscoveryTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", publicDiscoveryFile)],
    { only }
  );
}

function runGlobalPublicDiscoveryInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("public discovery contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    publicDiscoverySource,
    publicDiscoveryStats,
    mutationGuardSource
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, publicDiscoveryFile), "utf8"),
    stat(path.join(qualityDirectory, publicDiscoveryFile)),
    readFile(path.join(qualityDirectory, mutationGuardFile), "utf8")
  ]);
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const mutationTestNames = [
    ...mutationGuardSource.matchAll(/^mutationTest\(\n  "([^"]+)",/gm)
  ].map((match) => match[1]);
  const requiredOwnershipMutationNameCounts = Object.fromEntries(
    requiredOwnershipMutationTestNames.map((testName) => [
      testName,
      mutationTestNames.filter((name) => name === testName).length
    ])
  );
  assert.deepEqual(
    requiredOwnershipMutationNameCounts,
    Object.fromEntries(
      requiredOwnershipMutationTestNames.map((testName) => [testName, 1])
    ),
    `${mutationGuardFile} must register each required executable ownership mutation exactly once`
  );
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

  const adjacentLocationCounts = Object.fromEntries(
    adjacentMonolithTestNames.map((testName) => [
      testName,
      {
        focusedModule: [
          ...publicDiscoverySource.matchAll(
            new RegExp(JSON.stringify(testName), "g")
          )
        ].length,
        monolith: [
          ...monolithSource.matchAll(new RegExp(JSON.stringify(testName), "g"))
        ].length
      }
    ])
  );
  assert.deepEqual(
    adjacentLocationCounts,
    Object.fromEntries(
      adjacentMonolithTestNames.map((testName) => [
        testName,
        { focusedModule: 0, monolith: 1 }
      ])
    ),
    "the adjacent JavaScript, rejected-experiment, and new-tab contracts must remain exclusively in the monolith"
  );

  const runtimeReport = runPublicDiscoveryTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedPublicDiscoveryTestNames,
    `${publicDiscoveryFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedPublicDiscoveryTestNames.length,
      suites: 0,
      pass: expectedPublicDiscoveryTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${publicDiscoveryFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runPublicDiscoveryTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", publicDiscoveryFile)],
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
    `${publicDiscoveryFile} must not register test.only or an only option`
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
      runGlobalPublicDiscoveryInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedPublicDiscoveryTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedPublicDiscoveryTestNames.map((testName) => [testName, 1])
      ),
      "canonical public discovery test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed public discovery extraction boundary`
  );
  assert.equal(
    publicDiscoveryStats.size,
    publicDiscoveryExpectedBytes,
    `${publicDiscoveryFile} must be exactly ${publicDiscoveryExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = publicDiscoverySource.indexOf(
    publicDiscoveryBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${publicDiscoveryFile} must retain the first public discovery test`
  );
  assert.equal(
    bodyStart,
    publicDiscoverySource.lastIndexOf(publicDiscoveryBodyStartMarker),
    `${publicDiscoveryFile} must contain one unambiguous public discovery body start`
  );
  const publicDiscoveryHeader = publicDiscoverySource.slice(0, bodyStart);
  const publicDiscoveryBody = publicDiscoverySource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(publicDiscoveryHeader),
    publicDiscoveryBodyStartExpectedBytes,
    `${publicDiscoveryFile} assertion body must start at byte ${publicDiscoveryBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(publicDiscoveryHeader),
    publicDiscoveryHeaderExpectedSha256,
    `${publicDiscoveryFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(publicDiscoveryBody),
    publicDiscoveryBodyExpectedBytes,
    `${publicDiscoveryFile} assertion body must be exactly ${publicDiscoveryBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(publicDiscoveryBody),
    publicDiscoveryBodyExpectedSha256,
    `${publicDiscoveryFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
