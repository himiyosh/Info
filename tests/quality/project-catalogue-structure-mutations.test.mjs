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
const helperDirectory = path.join(repoRoot, "tests/helpers");
const boundaryAuthorityFile = "site-quality-boundary.mjs";
const guardFile = "project-catalogue-structure.test.mjs";
const mutationGuardFile = "project-catalogue-structure-mutations.test.mjs";
const catalogueFile = "project-catalogue.test.mjs";
const monolithFile = "site-quality.test.mjs";
const globalInventoryChildMode =
  process.env.INFO_PROJECT_CATALOGUE_INVENTORY === "complete-runtime-v1";
const mutationTest = globalInventoryChildMode ? test.skip : test;
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
const [
  boundaryAuthoritySource,
  guardSource,
  mutationGuardSource,
  catalogueSource,
  monolithSource
] = await Promise.all([
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
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
const monolithFixtureSource = padWithComment(
  "export {};\n",
  Buffer.byteLength(monolithSource)
);

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
  extraQualityFiles = {},
  guard = guardSource,
  mutationGuard = mutationGuardSource,
  monolith = monolithFixtureSource
} = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "info-catalogue-guard-"));
  const fixtureQualityDirectory = path.join(fixtureRoot, "tests/quality");
  const fixtureHelperDirectory = path.join(fixtureRoot, "tests/helpers");

  try {
    await Promise.all([
      mkdir(fixtureQualityDirectory, { recursive: true }),
      mkdir(fixtureHelperDirectory, { recursive: true })
    ]);
    await linkRuntimeFixtures(fixtureRoot);
    await Promise.all([
      writeFile(path.join(fixtureQualityDirectory, guardFile), guard),
      writeFile(path.join(fixtureQualityDirectory, mutationGuardFile), mutationGuard),
      writeFile(path.join(fixtureQualityDirectory, catalogueFile), catalogue),
      writeFile(path.join(fixtureQualityDirectory, monolithFile), monolith),
      writeFile(
        path.join(fixtureHelperDirectory, boundaryAuthorityFile),
        boundaryAuthoritySource
      ),
      ...Object.entries(extraQualityFiles).map(([file, source]) => {
        assert.equal(path.basename(file), file, "Extra quality fixtures must use a file name");
        assert.ok(file.endsWith(".test.mjs"), "Extra quality fixtures must be test modules");
        return writeFile(path.join(fixtureQualityDirectory, file), source);
      })
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

mutationTest("project catalogue structure guard accepts the reviewed unchanged extraction", async () => {
  const result = await runGuardMutation();
  assert.equal(result.status, 0, result.output);
});

mutationTest("project catalogue structure guard rejects spaced test registrations", async () => {
  const spacedDuplicate = appendSource(
    catalogueSource,
    `test (${JSON.stringify(catalogueTestNames[0])}, () => {});`
  );
  await assertMutationRejected(
    { catalogue: spacedDuplicate },
    /exact runtime test-name inventory/
  );
});

mutationTest("project catalogue structure guard rejects dynamic test registrations", async () => {
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

mutationTest("project catalogue structure guard rejects aliased test registrations", async () => {
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

mutationTest("project catalogue structure guard rejects runtime skip", async () => {
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

mutationTest("project catalogue structure guard rejects computed duplicate canonical names", async () => {
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

mutationTest("project catalogue structure guard rejects single-quoted canonical duplicates in another module", async () => {
  const singleQuotedDuplicate = [
    "import { test } from 'node:test';",
    "",
    `test(${JSON.stringify(catalogueTestNames[0]).replaceAll('"', "'")}, () => {});`,
    ""
  ].join("\n");
  await assertMutationRejected(
    {
      extraQualityFiles: {
        "single-quoted-catalogue-duplicate.test.mjs": singleQuotedDuplicate
      }
    },
    /canonical catalogue test names must be registered exactly once globally/
  );
});

mutationTest("project catalogue structure guard rejects split computed aliased duplicates in another module", async () => {
  const [firstNamePrefix, firstNameSuffix] = catalogueTestNames[0].split(
    " localization"
  );
  const computedAliasedDuplicate = [
    'import { test as registerTest } from "node:test";',
    "",
    `const canonicalName = ${JSON.stringify(`${firstNamePrefix} `)} + ${JSON.stringify(`localization${firstNameSuffix}`)};`,
    "registerTest(canonicalName, () => {});",
    ""
  ].join("\n");
  await assertMutationRejected(
    {
      extraQualityFiles: {
        "computed-catalogue-duplicate.test.mjs": computedAliasedDuplicate
      }
    },
    /canonical catalogue test names must be registered exactly once globally/
  );
});

mutationTest("project catalogue structure guard rejects nested canonical subtests behind nonmatching wrappers", async () => {
  const [firstNamePrefix, firstNameSuffix] = catalogueTestNames[0].split(
    " localization"
  );
  const nestedCanonicalDuplicate = [
    'import { test } from "node:test";',
    "",
    'test("unrelated wrapper", async (context) => {',
    `  const nestedName = ${JSON.stringify(`${firstNamePrefix} `)} + ${JSON.stringify(`localization${firstNameSuffix}`)};`,
    "  await context.test(nestedName, () => {});",
    "});",
    ""
  ].join("\n");
  await assertMutationRejected(
    {
      extraQualityFiles: {
        "nested-catalogue-duplicate.test.mjs": nestedCanonicalDuplicate
      }
    },
    /canonical catalogue test names must be registered exactly once globally/
  );
});

mutationTest("project catalogue structure guard inventories canonical registrations in guard modules", async () => {
  const [firstNamePrefix, firstNameSuffix] = catalogueTestNames[0].split(
    " localization"
  );
  const guardWithComputedDuplicate = appendSource(
    guardSource,
    [
      `const guardCanonicalName = ${JSON.stringify(`${firstNamePrefix} `)} + ${JSON.stringify(`localization${firstNameSuffix}`)};`,
      "test(guardCanonicalName, () => {});"
    ].join("\n")
  );
  await assertMutationRejected(
    { guard: guardWithComputedDuplicate },
    /canonical catalogue test names must be registered exactly once globally/
  );
});

mutationTest("project catalogue structure guard binds mutation wrapper source", async () => {
  const wrapperMarker =
    'mutationTest("project catalogue structure guard accepts the reviewed unchanged extraction", async () => {' +
    "\n  const result = await runGuardMutation();";
  const mutationGuardWithHiddenCanonical = replaceOnce(
    mutationGuardSource,
    wrapperMarker,
    wrapperMarker
      .replace("async ()", "async (context)")
      .replace(
        "\n  const result",
        "\n  const hiddenCanonicalName = catalogueTestNames[0].slice(0);" +
          "\n  await context.test(hiddenCanonicalName, () => {});" +
          "\n  const result"
      )
  );
  await assertMutationRejected(
    { mutationGuard: mutationGuardWithHiddenCanonical },
    /mutation guard source SHA-256/
  );
});

mutationTest("project catalogue structure guard rejects focused-module padding", async () => {
  await assertMutationRejected(
    { catalogue: `${catalogueSource} ` },
    /project-catalogue\.test\.mjs must be exactly 52002 bytes/
  );
});

mutationTest("project catalogue structure guard rejects monolith padding", async () => {
  await assertMutationRejected(
    { monolith: `${monolithFixtureSource} ` },
    /site-quality\.test\.mjs must be exactly 31213 bytes/
  );
});

mutationTest("project catalogue structure guard rejects empty stubs plus unrelated extraction", async () => {
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
