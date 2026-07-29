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
const guardFile = "mobile-navigation-contracts-structure.test.mjs";
const mutationGuardFile =
  "mobile-navigation-contracts-structure-mutations.test.mjs";
const mobileNavigationFile = "mobile-navigation-contracts.test.mjs";
const monolithFile = "site-quality.test.mjs";
const mobileNavigationInventoryEnvironment =
  "INFO_MOBILE_NAVIGATION_INVENTORY";
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode =
  process.env[mobileNavigationInventoryEnvironment] ===
  globalInventoryEnvironmentValue;
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = [
  "index.html",
  "script.js",
  "styles.css",
  "modern.css"
];
const [
  guardSource,
  mutationGuardSource,
  mobileNavigationSource,
  monolithSource
] = await Promise.all([
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, mobileNavigationFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const mobileNavigationTestNames = [
  ...mobileNavigationSource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const mobileNavigationBodyStart = mobileNavigationSource.indexOf(
  `test(${JSON.stringify(mobileNavigationTestNames[0])}`
);

assert.equal(
  mobileNavigationTestNames.length,
  3,
  "Mutation fixtures require the fixed three-test inventory"
);
assert.notEqual(
  mobileNavigationBodyStart,
  -1,
  "Mutation fixtures require the mobile navigation body boundary"
);
const monolithFixtureSource = padWithComment(
  "export {};\n",
  Buffer.byteLength(monolithSource)
);

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
}

async function runGuardMutation({
  mobileNavigation = mobileNavigationSource
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-mobile-navigation-guard-")
  );
  const fixtureQualityDirectory = path.join(fixtureRoot, "tests/quality");

  try {
    await mkdir(fixtureQualityDirectory, { recursive: true });
    await linkRuntimeFixtures(fixtureRoot);
    await Promise.all([
      writeFile(path.join(fixtureQualityDirectory, guardFile), guardSource),
      writeFile(
        path.join(fixtureQualityDirectory, mutationGuardFile),
        mutationGuardSource
      ),
      writeFile(
        path.join(fixtureQualityDirectory, mobileNavigationFile),
        mobileNavigation
      ),
      writeFile(
        path.join(fixtureQualityDirectory, monolithFile),
        monolithFixtureSource
      )
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

mutationTest(
  "mobile navigation structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "mobile navigation structure guard rejects a same-length padded inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      mobileNavigationBodyStart - 1
    )}\n`;
    const headerWrapperBypass = `${inertHeader}${mobileNavigationSource.slice(mobileNavigationBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(mobileNavigationSource)
    );
    assert.equal(
      headerWrapperBypass.slice(mobileNavigationBodyStart),
      mobileNavigationSource.slice(mobileNavigationBodyStart)
    );

    const result = await runGuardMutation({
      mobileNavigation: headerWrapperBypass
    });
    assert.notEqual(
      result.status,
      0,
      `The actual structure guard accepted the padded inert header wrapper:\n${result.output}`
    );
  }
);
