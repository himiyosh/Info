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
const guardFile = "asset-integrity-contracts-structure.test.mjs";
const mutationGuardFile =
  "asset-integrity-contracts-structure-mutations.test.mjs";
const assetIntegrityFile = "asset-integrity-contracts.test.mjs";
const sharedHelperFile = "asset-reference-parsing.mjs";
const monolithFile = "site-quality.test.mjs";
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
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = [
  "favicon.svg",
  "i18n.js",
  "index.html",
  "modern.css",
  "projects.json",
  "script.js",
  "sitemap.xml",
  "styles.css",
  "tokens.css"
];
const [
  guardSource,
  mutationGuardSource,
  assetIntegritySource,
  boundaryAuthoritySource,
  sharedHelperSource,
  monolithSource
] = await Promise.all([
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, assetIntegrityFile), "utf8"),
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(helperDirectory, sharedHelperFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const assetIntegrityTestNames = [
  ...assetIntegritySource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const assetIntegrityBodyStart = assetIntegritySource.indexOf(
  `test(${JSON.stringify(assetIntegrityTestNames[0])}`
);
const assetIntegrityHeader = assetIntegritySource.slice(
  0,
  assetIntegrityBodyStart
);
const assetIntegrityBodyBytes =
  Buffer.byteLength(assetIntegritySource) - assetIntegrityBodyStart;
assert.equal(
  assetIntegrityTestNames.length,
  4,
  "Mutation fixtures require the fixed four-test inventory"
);
assert.notEqual(
  assetIntegrityBodyStart,
  -1,
  "Mutation fixtures require the asset integrity body boundary"
);
const monolithFixtureSource = padWithComment(
  "export {};\n",
  Buffer.byteLength(monolithSource)
);

function appendSource(source, addition) {
  return `${source.trimEnd()}\n\n${addition}\n`;
}

function replaceOnce(source, marker, replacement) {
  assert.notEqual(source.indexOf(marker), -1, `Missing mutation marker: ${marker}`);
  assert.equal(
    source.indexOf(marker),
    source.lastIndexOf(marker),
    `Ambiguous mutation marker: ${marker}`
  );
  return source.replace(marker, replacement);
}

function padWithComment(source, targetBytes) {
  const remainingBytes = targetBytes - Buffer.byteLength(source);
  assert.ok(
    remainingBytes >= 4,
    "Mutation source must leave room for a block comment"
  );
  return `${source}/*${"x".repeat(remainingBytes - 4)}*/`;
}

async function linkRuntimeFixtures(rootDirectory) {
  await Promise.all(
    runtimeFixturePaths.map((relativePath) =>
      symlink(
        path.join(repoRoot, relativePath),
        path.join(rootDirectory, relativePath)
      )
    )
  );
  await symlink(
    path.join(repoRoot, "assets"),
    path.join(rootDirectory, "assets"),
    "dir"
  );
  await symlink(
    path.join(repoRoot, "en"),
    path.join(rootDirectory, "en"),
    "dir"
  );
  const githubDirectory = path.join(rootDirectory, ".github");
  await mkdir(githubDirectory);
  await symlink(
    path.join(repoRoot, ".github/pages-artifact-whitelist.txt"),
    path.join(githubDirectory, "pages-artifact-whitelist.txt")
  );
}

async function runGuardMutation({
  assetIntegrity = assetIntegritySource,
  extraQualityFiles = {},
  guard = guardSource,
  mutationGuard = mutationGuardSource,
  monolith = monolithFixtureSource,
  sharedHelper = sharedHelperSource
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-asset-integrity-guard-")
  );
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
      writeFile(
        path.join(fixtureQualityDirectory, mutationGuardFile),
        mutationGuard
      ),
      writeFile(
        path.join(fixtureQualityDirectory, assetIntegrityFile),
        assetIntegrity
      ),
      writeFile(
        path.join(fixtureQualityDirectory, monolithFile),
        monolith
      ),
      writeFile(
        path.join(fixtureHelperDirectory, boundaryAuthorityFile),
        boundaryAuthoritySource
      ),
      writeFile(
        path.join(fixtureHelperDirectory, sharedHelperFile),
        sharedHelper
      ),
      ...Object.entries(extraQualityFiles).map(([file, source]) => {
        assert.equal(
          path.basename(file),
          file,
          "Extra quality fixtures must use a file name"
        );
        assert.ok(
          file.endsWith(".test.mjs"),
          "Extra quality fixtures must be test modules"
        );
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
        timeout: 60_000
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

mutationTest(
  "asset integrity structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "asset integrity structure guard rejects computed duplicate registrations",
  async () => {
    const duplicateRegistration = appendSource(
      assetIntegritySource,
      [
        `const duplicateAssetIntegrityName = ${JSON.stringify(assetIntegrityTestNames[0])};`,
        "test(duplicateAssetIntegrityName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { assetIntegrity: duplicateRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects hidden global duplicates",
  async () => {
    const [namePrefix, nameSuffix] = assetIntegrityTestNames[0].split(
      " local files"
    );
    const hiddenDuplicate = [
      'import { test as registerTest } from "node:test";',
      "",
      `const canonicalName = ${JSON.stringify(`${namePrefix} `)} + ${JSON.stringify(`local files${nameSuffix}`)};`,
      "registerTest(canonicalName, () => {});",
      ""
    ].join("\n");
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "hidden-asset-integrity-duplicate.test.mjs": hiddenDuplicate
        }
      },
      /canonical asset integrity test names must be registered exactly once globally/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects skipped canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(assetIntegrityTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        assetIntegrity: replaceOnce(
          assetIntegritySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.skip(")
        )
      },
      /must execute all four contracts without skip or todo/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects todo canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(assetIntegrityTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        assetIntegrity: replaceOnce(
          assetIntegritySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.todo(")
        )
      },
      /must execute all four contracts without skip or todo/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects exclusive canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(assetIntegrityTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        assetIntegrity: replaceOnce(
          assetIntegritySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.only(")
        )
      },
      /must not register test\.only or an only option/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects focused-module padding",
  async () => {
    await assertMutationRejected(
      { assetIntegrity: `${assetIntegritySource} ` },
      /asset-integrity-contracts\.test\.mjs must be exactly 11612 bytes/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects monolith padding",
  async () => {
    await assertMutationRejected(
      { monolith: `${monolithFixtureSource} ` },
      /site-quality\.test\.mjs must be exactly 31213 bytes/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects shared-helper padding",
  async () => {
    await assertMutationRejected(
      { sharedHelper: `${sharedHelperSource} ` },
      /asset-reference-parsing\.mjs must be exactly 457 bytes/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects a same-length inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      assetIntegrityBodyStart - 1
    )}\n`;
    const headerWrapperBypass =
      `${inertHeader}${assetIntegritySource.slice(assetIntegrityBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(assetIntegritySource)
    );
    assert.equal(
      headerWrapperBypass.slice(assetIntegrityBodyStart),
      assetIntegritySource.slice(assetIntegrityBodyStart)
    );

    await assertMutationRejected(
      { assetIntegrity: headerWrapperBypass },
      /asset-integrity-contracts\.test\.mjs header SHA-256 must match the reviewed extraction/
    );
  }
);

mutationTest(
  "asset integrity structure guard rejects empty stubs plus unrelated extraction",
  async () => {
    const stubBody = [
      ...assetIntegrityTestNames.map(
        (name) => `test(${JSON.stringify(name)}, () => {});`
      ),
      "",
      "const unrelatedHeroAnimationExtraction = true;",
      ""
    ].join("\n");
    const unrelatedExtraction =
      `${assetIntegrityHeader}${padWithComment(stubBody, assetIntegrityBodyBytes)}`;

    assert.equal(
      Buffer.byteLength(unrelatedExtraction),
      Buffer.byteLength(assetIntegritySource)
    );

    await assertMutationRejected(
      { assetIntegrity: unrelatedExtraction },
      /assertion body SHA-256/
    );
  }
);

mutationTest(
  "asset integrity structure guard binds skipped mutation callbacks",
  async () => {
    const wrapperMarker = [
      "mutationTest(",
      '  "asset integrity structure guard accepts the reviewed unchanged extraction",',
      "  async () => {",
      "    const result = await runGuardMutation();"
    ].join("\n");
    const mutationGuardWithHiddenCanonical = replaceOnce(
      mutationGuardSource,
      wrapperMarker,
      wrapperMarker
        .replace("async ()", "async (context)")
        .replace(
          "\n    const result",
          "\n    const hiddenCanonicalName = assetIntegrityTestNames[0].slice(0);" +
            "\n    await context.test(hiddenCanonicalName, () => {});" +
            "\n    const result"
        )
    );
    await assertMutationRejected(
      { mutationGuard: mutationGuardWithHiddenCanonical },
      /mutation guard source SHA-256/
    );
  }
);
