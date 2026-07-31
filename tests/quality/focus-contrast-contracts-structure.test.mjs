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
const focusContrastFile = "focus-contrast-contracts.test.mjs";
const mutationGuardFile =
  "focus-contrast-contracts-structure-mutations.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY",
  "INFO_BASELINE_MOTION_SAFETY_INVENTORY",
  "INFO_REDUCED_MOTION_INVENTORY",
  "INFO_FOCUS_CONTRAST_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const focusContrastExpectedBytes = 7_773;
const focusContrastBodyStartExpectedBytes = 273;
const focusContrastHeaderExpectedSha256 =
  "0e56555309f1cd482e5b0a071cf213f6859415387ac7983795e29915a1781fb3";
const focusContrastBodyExpectedBytes = 7_500;
const focusContrastBodyExpectedSha256 =
  "a6c0d2aa616c89b50121f5d7947e1bd05f826fcbd08b4a70f1d037d006cb8e15";
const reviewedSourceSliceExpectedBytes = 7_501;
const reviewedSourceSliceExpectedSha256 =
  "7a4034411d7b56a35233d7e547d6f767c644852344a7b3eb7fd0545a12cbdf40";
const mutationGuardExpectedBytes = 20_554;
const mutationGuardExpectedSha256 =
  "1f658d409d1999f924cbcf70f3f6b8e3b5e0d162bf1df45527f7b22a0ec66e81";
const expectedFocusContrastTestNames = [
  "final modern focus-ring overrides match the actual project and contact surfaces",
  "focus-ring / backdrop token pairings meet WCAG 1.4.11 non-text contrast (>= 3:1)",
  "increased contrast strengthens muted roles and UI boundaries without changing the base theme"
];
const focusContrastNamePattern =
  `^(?:${expectedFocusContrastTestNames
    .map((testName) => testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})$`;
const requiredMutationTestNames = [
  "focus contrast structure guard accepts the reviewed unchanged extraction",
  "focus contrast structure guard rejects canonical names leaking into the monolith",
  "focus contrast structure guard rejects adjacent monolith contracts leaking into the focused module",
  "focus contrast structure guard rejects OKLCH helpers leaking into the monolith",
  "focus contrast structure guard rejects computed duplicate registrations",
  "focus contrast structure guard rejects dynamically assembled duplicate registrations",
  "focus contrast structure guard rejects hidden global duplicates",
  "focus contrast structure guard rejects skipped canonical contracts",
  "focus contrast structure guard rejects todo canonical contracts",
  "focus contrast structure guard rejects exclusive canonical contracts",
  "focus contrast structure guard rejects runtime-disabled canonical contracts",
  "focus contrast structure guard binds the final focus selector assertion",
  "focus contrast structure guard binds the on-dark focus exclusion assertion",
  "focus contrast structure guard binds the WCAG non-text contrast assertion",
  "focus contrast structure guard binds the increased-contrast improvement assertion",
  "focus contrast structure guard rejects focused-module padding",
  "focus contrast structure guard rejects monolith padding",
  "focus contrast structure guard rejects a same-length inert header wrapper",
  "focus contrast structure guard rejects empty stubs plus unrelated extraction",
  "focus contrast structure guard binds skipped mutation callbacks"
];
const adjacentMonolithTestNames = [
  "micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion",
  "color-scheme metadata matches the shipped dark-only theme"
];
const focusContrastHelperNames = [
  "parseOklchTokens",
  "relativeLuminanceFromOklch",
  "oklchContrastRatio"
];
const focusContrastBodyStartMarker =
  "// OKLCH -> linear sRGB -> WCAG relative luminance, used to compute real";
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
        ? [`--test-name-pattern=${focusContrastNamePattern}`]
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

  assertQualitySpawnCompleted(result, "focus/contrast inventory");
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for focus/contrast inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runFocusContrastTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", focusContrastFile)],
    { only }
  );
}

function runGlobalFocusContrastInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles.map((file) =>
    path.posix.join("tests", "quality", file)
  );
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("focus and contrast contracts live in one focused module", async () => {
  const [
    entries,
    monolithSource,
    monolithStats,
    focusContrastSource,
    focusContrastStats,
    mutationGuardSource
  ] = await Promise.all([
    readdir(qualityDirectory, { withFileTypes: true }),
    readFile(path.join(qualityDirectory, monolithFile), "utf8"),
    stat(path.join(qualityDirectory, monolithFile)),
    readFile(path.join(qualityDirectory, focusContrastFile), "utf8"),
    stat(path.join(qualityDirectory, focusContrastFile)),
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
    expectedFocusContrastTestNames.map((testName) => [
      testName,
      countLiteralOccurrences(monolithSource, JSON.stringify(testName))
    ])
  );

  assert.deepEqual(
    {
      focusedModulePresent: qualityTestFiles.includes(focusContrastFile),
      monolithCanonicalNameCounts
    },
    {
      focusedModulePresent: true,
      monolithCanonicalNameCounts: Object.fromEntries(
        expectedFocusContrastTestNames.map((testName) => [testName, 0])
      )
    },
    `${focusContrastFile} must exclusively own the three canonical focus/contrast contracts`
  );

  const adjacentNameLocations = Object.fromEntries(
    adjacentMonolithTestNames.map((testName) => [
      testName,
      {
        focusedModuleCount: countLiteralOccurrences(
          focusContrastSource,
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
    "the adjacent parallax and color-scheme contracts must remain exclusively in the monolith"
  );

  const helperDefinitionLocations = Object.fromEntries(
    focusContrastHelperNames.map((helperName) => {
      const definitionPattern = new RegExp(
        `\\bfunction\\s+${helperName}\\s*\\(`,
        "g"
      );
      return [
        helperName,
        {
          focusedModuleCount: [
            ...focusContrastSource.matchAll(definitionPattern)
          ].length,
          monolithCount: [...monolithSource.matchAll(definitionPattern)].length
        }
      ];
    })
  );
  assert.deepEqual(
    helperDefinitionLocations,
    Object.fromEntries(
      focusContrastHelperNames.map((helperName) => [
        helperName,
        {
          focusedModuleCount: 1,
          monolithCount: 0
        }
      ])
    ),
    `OKLCH contrast helpers must remain exclusively in ${focusContrastFile}`
  );

  const runtimeReport = runFocusContrastTests();
  assert.deepEqual(
    runtimeReport.names,
    expectedFocusContrastTestNames,
    `${focusContrastFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedFocusContrastTestNames.length,
      suites: 0,
      pass: expectedFocusContrastTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${focusContrastFile} must execute all three contracts without skip or todo`
  );

  const onlyReport = runFocusContrastTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", focusContrastFile)],
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
    `${focusContrastFile} must not register test.only or an only option`
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
      runGlobalFocusContrastInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedFocusContrastTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedFocusContrastTestNames.map((testName) => [testName, 1])
      ),
      "canonical focus/contrast test names must be registered exactly once globally"
    );
  }

  assert.equal(
    monolithStats.size,
    siteQualityExpectedBytes,
    `${monolithFile} must be exactly ${siteQualityExpectedBytes} bytes at the reviewed focus/contrast extraction boundary`
  );
  assert.equal(
    focusContrastStats.size,
    focusContrastExpectedBytes,
    `${focusContrastFile} must be exactly ${focusContrastExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = focusContrastSource.indexOf(
    focusContrastBodyStartMarker
  );
  assert.notEqual(
    bodyStart,
    -1,
    `${focusContrastFile} must retain the OKLCH helper boundary`
  );
  assert.equal(
    bodyStart,
    focusContrastSource.lastIndexOf(focusContrastBodyStartMarker),
    `${focusContrastFile} must contain one unambiguous focus/contrast body start`
  );
  const focusContrastHeader = focusContrastSource.slice(0, bodyStart);
  const focusContrastBody = focusContrastSource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(focusContrastHeader),
    focusContrastBodyStartExpectedBytes,
    `${focusContrastFile} assertion body must start at byte ${focusContrastBodyStartExpectedBytes}`
  );
  assert.equal(
    sha256(focusContrastHeader),
    focusContrastHeaderExpectedSha256,
    `${focusContrastFile} header SHA-256 must match the reviewed extraction`
  );
  assert.equal(
    Buffer.byteLength(focusContrastBody),
    focusContrastBodyExpectedBytes,
    `${focusContrastFile} assertion body must be exactly ${focusContrastBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(focusContrastBody),
    focusContrastBodyExpectedSha256,
    `${focusContrastFile} assertion body SHA-256 must match the reviewed extraction`
  );
  const reconstructedSourceSlice = `${focusContrastBody}\n`;
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
