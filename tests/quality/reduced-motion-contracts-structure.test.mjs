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
const reducedMotionFile = "reduced-motion-contracts.test.mjs";
const mutationGuardFile =
  "reduced-motion-contracts-structure-mutations.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY",
  "INFO_BASELINE_MOTION_SAFETY_INVENTORY",
  "INFO_REDUCED_MOTION_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const reducedMotionExpectedBytes = 4_988;
const reducedMotionBodyStartExpectedBytes = 273;
const reducedMotionHeaderExpectedSha256 =
  "0e56555309f1cd482e5b0a071cf213f6859415387ac7983795e29915a1781fb3";
const reducedMotionBodyExpectedBytes = 4_715;
const reducedMotionBodyExpectedSha256 =
  "35f474124c0eceb492fea3f3c6c866464d5695cba08bc8d75ee95b145edc208e";
const reviewedSourceSliceExpectedBytes = 4_716;
const reviewedSourceSliceExpectedSha256 =
  "188904a166968900d5d0e553c8dc33187a738d145360cddd2ad4f03462559ff7";
const mutationGuardExpectedBytes = 17_282;
const mutationGuardExpectedSha256 =
  "669839c094f5adee9d49e3eb3866d7a8fe8d83888b2f8690330a721968a001c2";
const expectedReducedMotionTestNames = [
  "reduced motion nulls every new spatial transform, disables non-essential motion, and keeps the wordmark-mark rotation invariant",
  "reduced motion preference is live: a runtime change arms/disarms motion without duplicate observers"
];
const reducedMotionNamePattern =
  `^(?:${expectedReducedMotionTestNames
    .map((testName) => testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})$`;
const requiredMutationTestNames = [
  "reduced motion structure guard accepts the reviewed unchanged extraction",
  "reduced motion structure guard rejects canonical names leaking into the monolith",
  "reduced motion structure guard rejects adjacent monolith contracts leaking into the focused module",
  "reduced motion structure guard rejects OKLCH helpers leaking into the focused module",
  "reduced motion structure guard rejects computed duplicate registrations",
  "reduced motion structure guard rejects dynamically assembled duplicate registrations",
  "reduced motion structure guard rejects hidden global duplicates",
  "reduced motion structure guard rejects skipped canonical contracts",
  "reduced motion structure guard rejects todo canonical contracts",
  "reduced motion structure guard rejects exclusive canonical contracts",
  "reduced motion structure guard rejects runtime-disabled canonical contracts",
  "reduced motion structure guard rejects focused-module padding",
  "reduced motion structure guard rejects monolith padding",
  "reduced motion structure guard rejects a same-length inert header wrapper",
  "reduced motion structure guard rejects empty stubs plus unrelated extraction",
  "reduced motion structure guard binds skipped mutation callbacks"
];
const adjacentMonolithTestNames = [
  "micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion",
  "color-scheme metadata matches the shipped dark-only theme"
];
const extractedFocusContrastHelperNames = [
  "parseOklchTokens",
  "relativeLuminanceFromOklch",
  "oklchContrastRatio"
];
const reducedMotionBodyStartMarker =
  `test(${JSON.stringify(expectedReducedMotionTestNames[0])}`;
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

function countLiteralOccurrences(source, value) {
  return source.split(value).length - 1;
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
        ? [`--test-name-pattern=${reducedMotionNamePattern}`]
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

  assertQualitySpawnCompleted(result, "reduced-motion inventory");
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for reduced-motion inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runReducedMotionTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", reducedMotionFile)],
    { only }
  );
}

function runGlobalReducedMotionInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("reduced motion contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    reducedMotionSource,
    reducedMotionStats,
    mutationGuardSource
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, reducedMotionFile), "utf8"),
    stat(path.join(qualityDirectory, reducedMotionFile)),
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
    expectedReducedMotionTestNames.map((testName) => [
      testName,
      countLiteralOccurrences(monolithSource, JSON.stringify(testName))
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(reducedMotionFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedReducedMotionTestNames.map((testName) => [testName, 0])
      )
    },
    `${reducedMotionFile} must exclusively own the two canonical reduced-motion contracts`
  );

  const adjacentNameLocations = Object.fromEntries(
    adjacentMonolithTestNames.map((testName) => [
      testName,
      {
        focusedModuleCount: countLiteralOccurrences(
          reducedMotionSource,
          JSON.stringify(testName)
        ),
        monolithCount: countLiteralOccurrences(
          monolithSource,
          JSON.stringify(testName)
        )
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
    "adjacent parallax and color-scheme contracts must remain exclusively in the monolith"
  );

  const helperDefinitionLocations = Object.fromEntries(
    extractedFocusContrastHelperNames.map((helperName) => {
      const definitionPattern = new RegExp(
        `\\bfunction\\s+${helperName}\\s*\\(`,
        "g"
      );
      return [
        helperName,
        {
          focusedModuleCount: [
            ...reducedMotionSource.matchAll(definitionPattern)
          ].length,
          monolithCount: [...monolithSource.matchAll(definitionPattern)].length
        }
      ];
    })
  );
  assert.deepEqual(
    helperDefinitionLocations,
    Object.fromEntries(
      extractedFocusContrastHelperNames.map((helperName) => [
        helperName,
        {
          focusedModuleCount: 0,
          monolithCount: 0
        }
      ])
    ),
    "OKLCH contrast helpers must not remain in the monolith or leak into reduced-motion-contracts.test.mjs"
  );

  const runtimeReport = runReducedMotionTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedReducedMotionTestNames,
    `${reducedMotionFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedReducedMotionTestNames.length,
      suites: 0,
      pass: expectedReducedMotionTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${reducedMotionFile} must execute both contracts without skip or todo`
  );

  const onlyReport = runReducedMotionTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", reducedMotionFile)],
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
    `${reducedMotionFile} must not register test.only or an only option`
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
      runGlobalReducedMotionInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedReducedMotionTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedReducedMotionTestNames.map((testName) => [testName, 1])
      ),
      "canonical reduced-motion test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed reduced-motion extraction boundary`
  );
  assert.equal(
    reducedMotionStats.size,
    reducedMotionExpectedBytes,
    `${reducedMotionFile} must be exactly ${reducedMotionExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = reducedMotionSource.indexOf(
    reducedMotionBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${reducedMotionFile} must retain the first reduced-motion test`
  );
  assert.equal(
    bodyStart,
    reducedMotionSource.lastIndexOf(reducedMotionBodyStartMarker),
    `${reducedMotionFile} must contain one unambiguous reduced-motion body start`
  );
  const reducedMotionHeader = reducedMotionSource.slice(0, bodyStart);
  const reducedMotionBody = reducedMotionSource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(reducedMotionHeader),
    reducedMotionBodyStartExpectedBytes,
    `${reducedMotionFile} assertion body must start at byte ${reducedMotionBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(reducedMotionHeader),
    reducedMotionHeaderExpectedSha256,
    `${reducedMotionFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(reducedMotionBody),
    reducedMotionBodyExpectedBytes,
    `${reducedMotionFile} assertion body must be exactly ${reducedMotionBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(reducedMotionBody),
    reducedMotionBodyExpectedSha256,
    `${reducedMotionFile} assertion body SHA-256 must match the reviewed extraction`
  );
  const reconstructedSourceSlice = `${reducedMotionBody}\n`;
  assert.equal(
    Buffer.byteLength(reconstructedSourceSlice),
    reviewedSourceSliceExpectedBytes,
    `The focused body plus its removed separator must reconstruct the ${reviewedSourceSliceExpectedBytes}-byte source slice`
  );
  assert.equal(
    sha256(reconstructedSourceSlice),
    reviewedSourceSliceExpectedSha256,
    "The focused body plus its removed separator must match the reviewed source-slice SHA-256"
  );
});
