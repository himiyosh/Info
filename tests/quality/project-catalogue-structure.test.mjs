import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const catalogueFile = "project-catalogue.test.mjs";
const guardFile = "project-catalogue-structure.test.mjs";
const mutationGuardFile = "project-catalogue-structure-mutations.test.mjs";
const globalInventoryEnvironment = "INFO_PROJECT_CATALOGUE_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[globalInventoryEnvironment] === globalInventoryEnvironmentValue;
const monolithExpectedBytes = 88_634;
const catalogueExpectedBytes = 52_002;
const catalogueBodyStartExpectedBytes = 8_196;
const catalogueBodyExpectedBytes = 43_806;
const catalogueBodyExpectedSha256 =
  "d9b94bf0f5f70fdb7fe289aa32f5da411539958825b1602c1e11561feb4a7821";
const mutationGuardExpectedBytes = 12_145;
const mutationGuardExpectedSha256 =
  "320f4a78e6e68c44d8b77cc82cf5f3060f4044158b94e6fa7f62550c6a98d7d9";
const expectedCatalogueTestNames = [
  "projects.json schema, localization, links, and preview assets are valid",
  "exactly six live projects expose verified public source actions",
  "exactly eight public projects expose reviewed immutable proof citations",
  "project runtime rejects incomplete, malformed, duplicate, and primary-equal source actions",
  "project action groups preserve primary-first safe localized links and responsive focus behavior",
  "project proof renders as a compact cited surface after primary actions",
  "mobile project AVIF pairs meet dimension and bandwidth budgets",
  "desktop project AVIF pairs meet exact format, dimensions, and bandwidth budgets",
  "project runtime validation requires distinct local JPEG and AVIF assets",
  "project rendering emits mutually exclusive AVIF sources before lazy JPEG fallbacks",
  "project catalogue status stays concise, atomic, and separate from rendered results"
];
const catalogueBodyStartMarker = `test(${JSON.stringify(expectedCatalogueTestNames[0])}`;
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
    childProcessEnv[globalInventoryEnvironment] =
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
    timeout: 30_000
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `Quality test modules must execute successfully for structural inventory:\n${result.stdout}${result.stderr}`
  );
  return parseJunitReport(result.stdout);
}

function runCatalogueTests({ only = false } = {}) {
  return runTestModules(
    [path.posix.join("tests", "quality", catalogueFile)],
    { only }
  );
}

function runGlobalCatalogueInventory(qualityTestFiles) {
  const runtimeFiles = qualityTestFiles
    .map((file) => path.posix.join("tests", "quality", file));
  return runTestModules(runtimeFiles, { globalInventory: true });
}

test("site quality monolith stays below the project catalogue extraction boundary", async () => {
  const monolithStats = await stat(path.join(qualityDirectory, monolithFile));
  assert.equal(
    monolithStats.size,
    monolithExpectedBytes,
    `${monolithFile} must be exactly ${monolithExpectedBytes} bytes at the reviewed extraction boundary`
  );
});

test("project catalogue tests live in one focused bounded module", async () => {
  const entries = await readdir(qualityDirectory, { withFileTypes: true });
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(
    qualityTestFiles.includes(catalogueFile),
    `${catalogueFile} must own the fixed project catalogue quality contracts`
  );

  const catalogueSource = await readFile(
    path.join(qualityDirectory, catalogueFile),
    "utf8"
  );
  const mutationGuardSource = await readFile(
    path.join(qualityDirectory, mutationGuardFile),
    "utf8"
  );
  const catalogueStats = await stat(path.join(qualityDirectory, catalogueFile));
  const runtimeReport = runCatalogueTests();

  assert.deepEqual(
    runtimeReport.names,
    expectedCatalogueTestNames,
    `${catalogueFile} must retain the exact runtime test-name inventory`
  );
  assert.deepEqual(
    runtimeReport.summary,
    {
      tests: expectedCatalogueTestNames.length,
      suites: 0,
      pass: expectedCatalogueTestNames.length,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0
    },
    `${catalogueFile} must execute all 11 contracts without skip or todo`
  );

  const onlyReport = runCatalogueTests({ only: true });
  assert.deepEqual(
    onlyReport,
    {
      names: [path.posix.join("tests", "quality", catalogueFile)],
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
    `${catalogueFile} must not register test.only or an only option`
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
    const globalReport = runGlobalCatalogueInventory(qualityTestFiles);
    const globalCounts = Object.fromEntries(
      expectedCatalogueTestNames.map((testName) => [
        testName,
        globalReport.names.filter((name) => name === testName).length
      ])
    );
    assert.deepEqual(
      globalCounts,
      Object.fromEntries(
        expectedCatalogueTestNames.map((testName) => [testName, 1])
      ),
      "canonical catalogue test names must be registered exactly once globally"
    );
  }

  assert.equal(
    catalogueStats.size,
    catalogueExpectedBytes,
    `${catalogueFile} must be exactly ${catalogueExpectedBytes} bytes at the reviewed extraction boundary`
  );

  const bodyStart = catalogueSource.indexOf(catalogueBodyStartMarker);
  assert.notEqual(bodyStart, -1, `${catalogueFile} must retain the first catalogue test`);
  assert.equal(
    bodyStart,
    catalogueSource.lastIndexOf(catalogueBodyStartMarker),
    `${catalogueFile} must contain one unambiguous catalogue body start`
  );
  const catalogueHeader = catalogueSource.slice(0, bodyStart);
  const catalogueBody = catalogueSource.slice(bodyStart);
  assert.equal(
    Buffer.byteLength(catalogueHeader),
    catalogueBodyStartExpectedBytes,
    `${catalogueFile} assertion body must start at byte ${catalogueBodyStartExpectedBytes}`
  );
  assert.equal(
    Buffer.byteLength(catalogueBody),
    catalogueBodyExpectedBytes,
    `${catalogueFile} assertion body must be exactly ${catalogueBodyExpectedBytes} bytes`
  );
  assert.equal(
    sha256(catalogueBody),
    catalogueBodyExpectedSha256,
    `${catalogueFile} assertion body SHA-256 must match the reviewed extraction`
  );
});
