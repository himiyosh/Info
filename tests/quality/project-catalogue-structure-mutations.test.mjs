import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const guardFile = "project-catalogue-structure.test.mjs";
const catalogueFile = "project-catalogue.test.mjs";
const monolithFile = "site-quality.test.mjs";
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = [
  "projects.json",
  "index.html",
  "i18n.js",
  "script.js",
  "styles.css",
  "modern.css"
];
const [guardSource, catalogueSource, monolithSource] = await Promise.all([
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, catalogueFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const catalogueTestNames = [
  ...catalogueSource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const catalogueBodyStart = catalogueSource.indexOf(
  `test(${JSON.stringify(catalogueTestNames[0])}`
);

assert.equal(catalogueTestNames.length, 11, "Mutation fixtures require the fixed 11-test inventory");
assert.notEqual(catalogueBodyStart, -1, "Mutation fixtures require the catalogue body boundary");

function appendSource(source, addition) {
  return `${source.trimEnd()}\n\n${addition}\n`;
}

function replaceOnce(source, marker, replacement) {
  assert.notEqual(source.indexOf(marker), -1, `Missing mutation marker: ${marker}`);
  assert.equal(source.indexOf(marker), source.lastIndexOf(marker), `Ambiguous mutation marker: ${marker}`);
  return source.replace(marker, replacement);
}

function padWithComment(source, targetBytes) {
  const remainingBytes = targetBytes - Buffer.byteLength(source);
  assert.ok(remainingBytes >= 4, "Mutation source must leave room for a block comment");
  return `${source}/*${"x".repeat(remainingBytes - 4)}*/`;
}

async function linkRuntimeFixtures(rootDirectory) {
  await Promise.all(
    runtimeFixturePaths.map((relativePath) =>
      symlink(path.join(repoRoot, relativePath), path.join(rootDirectory, relativePath))
    )
  );
  await symlink(path.join(repoRoot, "assets"), path.join(rootDirectory, "assets"), "dir");
  const githubDirectory = path.join(rootDirectory, ".github");
  await mkdir(githubDirectory);
  await symlink(
    path.join(repoRoot, ".github/pages-artifact-whitelist.txt"),
    path.join(githubDirectory, "pages-artifact-whitelist.txt")
  );
}

async function runGuardMutation({
  catalogue = catalogueSource,
  monolith = monolithSource
} = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "info-catalogue-guard-"));
  const fixtureQualityDirectory = path.join(fixtureRoot, "tests/quality");

  try {
    await mkdir(fixtureQualityDirectory, { recursive: true });
    await linkRuntimeFixtures(fixtureRoot);
    await Promise.all([
      writeFile(path.join(fixtureQualityDirectory, guardFile), guardSource),
      writeFile(path.join(fixtureQualityDirectory, catalogueFile), catalogue),
      writeFile(path.join(fixtureQualityDirectory, monolithFile), monolith)
    ]);

    const result = spawnSync(
      process.execPath,
      ["--test", path.join("tests/quality", guardFile)],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: childProcessEnv,
        timeout: 30_000
      }
    );
    assert.ifError(result.error);
    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function assertMutationRejected(mutation, expectedMessage) {
  const result = await runGuardMutation(mutation);
  assert.notEqual(
    result.status,
    0,
    `The actual structure guard accepted a prohibited mutation:\n${result.output}`
  );
  assert.match(result.output, expectedMessage);
}

test("project catalogue structure guard accepts the reviewed unchanged extraction", async () => {
  const result = await runGuardMutation();
  assert.equal(result.status, 0, result.output);
});

test("project catalogue structure guard rejects spaced test registrations", async () => {
  const spacedDuplicate = appendSource(
    catalogueSource,
    `test (${JSON.stringify(catalogueTestNames[0])}, () => {});`
  );
  await assertMutationRejected(
    { catalogue: spacedDuplicate },
    /exact runtime test-name inventory/
  );
});

test("project catalogue structure guard rejects dynamic test registrations", async () => {
  const dynamicRegistration = appendSource(
    catalogueSource,
    [
      'const dynamicCatalogueName = ["dynamic", "catalogue", "contract"].join(" ");',
      "test(dynamicCatalogueName, () => {});"
    ].join("\n")
  );
  await assertMutationRejected(
    { catalogue: dynamicRegistration },
    /exact runtime test-name inventory/
  );
});

test("project catalogue structure guard rejects aliased test registrations", async () => {
  const aliasedRegistration = appendSource(
    catalogueSource,
    [
      "const registerCatalogueTest = test;",
      'registerCatalogueTest("aliased catalogue contract", () => {});'
    ].join("\n")
  );
  await assertMutationRejected(
    { catalogue: aliasedRegistration },
    /exact runtime test-name inventory/
  );
});

test("project catalogue structure guard rejects runtime skip", async () => {
  const firstTestMarker = `test(${JSON.stringify(catalogueTestNames[0])}, async () => {`;
  const runtimeSkip = replaceOnce(
    catalogueSource,
    firstTestMarker,
    `${firstTestMarker.slice(0, -"() => {".length)}(context) => {\n  context.skip("mutation");\n  return;`
  );
  await assertMutationRejected(
    { catalogue: runtimeSkip },
    /must execute all 11 contracts without skip or todo/
  );
});

test("project catalogue structure guard rejects computed duplicate canonical names", async () => {
  const computedDuplicate = appendSource(
    catalogueSource,
    [
      `const duplicateCatalogueName = ${JSON.stringify(catalogueTestNames[0])};`,
      "test(duplicateCatalogueName, () => {});"
    ].join("\n")
  );
  await assertMutationRejected(
    { catalogue: computedDuplicate },
    /exact runtime test-name inventory/
  );
});

test("project catalogue structure guard rejects focused-module padding", async () => {
  await assertMutationRejected(
    { catalogue: `${catalogueSource} ` },
    /project-catalogue\.test\.mjs must be exactly 52002 bytes/
  );
});

test("project catalogue structure guard rejects monolith padding", async () => {
  await assertMutationRejected(
    { monolith: `${monolithSource} ` },
    /site-quality\.test\.mjs must be exactly 88634 bytes/
  );
});

test("project catalogue structure guard rejects empty stubs plus unrelated extraction", async () => {
  const stubHeader = padWithComment(
    [
      'import { test } from "node:test";',
      "",
      "const unrelatedDeploymentContract = true;",
      ""
    ].join("\n"),
    catalogueBodyStart
  );
  const stubBody = [
    ...catalogueTestNames.map((name) => `test(${JSON.stringify(name)}, () => {});`),
    ""
  ].join("\n");
  const unrelatedExtraction = padWithComment(
    `${stubHeader}${stubBody}`,
    Buffer.byteLength(catalogueSource)
  );

  await assertMutationRejected(
    { catalogue: unrelatedExtraction },
    /assertion body SHA-256/
  );
});
