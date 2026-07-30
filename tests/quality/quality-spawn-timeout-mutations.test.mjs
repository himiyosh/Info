import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertQualitySpawnCompleted,
  qualitySpawnTimeoutMs
} from "../helpers/quality-spawn.mjs";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const helperDirectory = path.join(repoRoot, "tests/helpers");
const spawnHelperFile = "quality-spawn.mjs";
const guardFile = "quality-spawn-timeout.test.mjs";
// npm test already saturates a two-core runner with ten nested full-suite
// spawns, so each fixture run is restricted to the coverage contract, which
// reads sources and spawns nothing of its own.
const coverageTestName =
  "nested quality-suite spawns share the reviewed spawn-timeout helper";
const regressionTargetFile = "asset-integrity-contracts-structure.test.mjs";
const regressionTargetLabel = "asset integrity inventory";
const workflowRelativePath = ".github/workflows/quality-baseline.yml";
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
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const regressedSpawnTimeoutMs = 60_000;
// These fragments are assembled at runtime so that this fixture's own source
// never contains a hardcoded spawn timeout, an assert.ifError call, or an extra
// spawnSync call site. The guard under test reads every inventoried module's
// source, and this module is inventoried too.
const sharedTimeoutProperty = ["timeout", "qualitySpawnTimeoutMs"].join(": ");
const hardcodedTimeoutProperty = [
  "timeout",
  String(regressedSpawnTimeoutMs)
].join(": ");
const legacySpawnAssertion = `${["assert", "ifError"].join(".")}(result.error);`;
const unspacedSpawnCall = ["spawnSync", "(process.execPath"].join("");
const spacedSpawnCall = ["spawnSync", "(process.execPath"].join(" ");
const concealedFlagDeclaration = `const concealedTestFlag = ${JSON.stringify("--te")} + ${JSON.stringify("st")};`;
const hiddenSpawnerSource = [
  'import { spawnSync } from "node:child_process";',
  'import { test } from "node:test";',
  "",
  'test("an unlisted module spawns a nested quality run", () => {',
  `  ${["spawnSync", '(process.execPath, ["--test", "tests/quality/site-quality.test.mjs"]);'].join("")}`,
  "});",
  ""
].join("\n");
const [guardSource, regressionTargetSource, spawnHelperSource, qualityEntries] =
  await Promise.all([
    readFile(path.join(qualityDirectory, guardFile), "utf8"),
    readFile(path.join(qualityDirectory, regressionTargetFile), "utf8"),
    readFile(path.join(helperDirectory, spawnHelperFile), "utf8"),
    readdir(qualityDirectory, { withFileTypes: true })
  ]);
const qualityFixtureFiles = qualityEntries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);

function replaceOnce(source, marker, replacement) {
  assert.notEqual(
    source.indexOf(marker),
    -1,
    `Missing mutation marker: ${marker}`
  );
  assert.equal(
    source.indexOf(marker),
    source.lastIndexOf(marker),
    `Ambiguous mutation marker: ${marker}`
  );
  return source.replace(marker, replacement);
}

const regressedTargetSource = replaceOnce(
  replaceOnce(
    regressionTargetSource,
    sharedTimeoutProperty,
    hardcodedTimeoutProperty
  ),
  `assertQualitySpawnCompleted(result, ${JSON.stringify(regressionTargetLabel)});`,
  legacySpawnAssertion
);

// Unmutated fixture files are hard-linked rather than copied so the harness
// adds almost no work to an already saturated runner. Anything this fixture
// writes must therefore never be linked first, or the write would reach the
// repository file through the shared inode.
async function materialize(sourcePath, destinationPath) {
  try {
    await link(sourcePath, destinationPath);
  } catch {
    await copyFile(sourcePath, destinationPath);
  }
}

async function runGuardMutation({
  guard = guardSource,
  qualityOverrides = {},
  extraQualityFiles = {}
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-quality-spawn-guard-")
  );
  const fixtureQualityDirectory = path.join(fixtureRoot, "tests/quality");
  const fixtureHelperDirectory = path.join(fixtureRoot, "tests/helpers");
  const writtenQualityFiles = new Set([
    guardFile,
    ...Object.keys(qualityOverrides),
    ...Object.keys(extraQualityFiles)
  ]);

  try {
    await Promise.all([
      mkdir(fixtureQualityDirectory, { recursive: true }),
      mkdir(fixtureHelperDirectory, { recursive: true }),
      mkdir(path.join(fixtureRoot, path.dirname(workflowRelativePath)), {
        recursive: true
      })
    ]);
    await Promise.all([
      materialize(
        path.join(repoRoot, workflowRelativePath),
        path.join(fixtureRoot, workflowRelativePath)
      ),
      ...qualityFixtureFiles
        .filter((file) => !writtenQualityFiles.has(file))
        .map((file) =>
          materialize(
            path.join(qualityDirectory, file),
            path.join(fixtureQualityDirectory, file)
          )
        )
    ]);
    await Promise.all([
      writeFile(
        path.join(fixtureHelperDirectory, spawnHelperFile),
        spawnHelperSource
      ),
      writeFile(path.join(fixtureQualityDirectory, guardFile), guard),
      ...Object.entries(qualityOverrides).map(([file, source]) => {
        assert.equal(
          path.basename(file),
          file,
          "Quality overrides must use a file name"
        );
        return writeFile(path.join(fixtureQualityDirectory, file), source);
      }),
      ...Object.entries(extraQualityFiles).map(([file, source]) => {
        assert.ok(
          file.endsWith(".test.mjs") && path.basename(file) === file,
          "Extra quality fixtures must be named test modules"
        );
        return writeFile(path.join(fixtureQualityDirectory, file), source);
      })
    ]);

    const result = spawnSync(
      process.execPath,
      [
        "--test",
        `--test-name-pattern=^${coverageTestName}$`,
        path.join("tests/quality", guardFile)
      ],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: childProcessEnv,
        timeout: qualitySpawnTimeoutMs
      }
    );
    assertQualitySpawnCompleted(
      result,
      "the quality spawn-timeout guard fixture"
    );
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
    `The actual spawn-timeout guard accepted a prohibited mutation:\n${result.output}`
  );
  assert.match(result.output, expectedMessage);
}

mutationTest(
  "spawn-timeout guard accepts the reviewed repository layout",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "spawn-timeout guard rejects a hardcoded budget behind a requoted nested-run flag",
  async () => {
    const requoted = replaceOnce(
      regressedTargetSource,
      '"--test",',
      "'--test',"
    );

    assert.ok(
      !requoted.includes('"--test"'),
      "The requote mutation must remove the double-quoted nested-run flag"
    );
    await assertMutationRejected(
      { qualityOverrides: { [regressionTargetFile]: requoted } },
      /must not hardcode a spawn timeout/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a hardcoded budget behind a spaced spawnSync call",
  async () => {
    const spaced = replaceOnce(
      regressedTargetSource,
      unspacedSpawnCall,
      spacedSpawnCall
    );

    assert.ok(
      !spaced.includes(unspacedSpawnCall),
      "The spacing mutation must remove the unspaced spawnSync call site"
    );
    await assertMutationRejected(
      { qualityOverrides: { [regressionTargetFile]: spaced } },
      /must not hardcode a spawn timeout/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested spawner that hides its nested-run flag",
  async () => {
    const concealed = replaceOnce(
      replaceOnce(
        regressionTargetSource,
        "  const args = [",
        `  ${concealedFlagDeclaration}\n  const args = [`
      ),
      '    "--test",',
      "    concealedTestFlag,"
    );

    assert.ok(
      !concealed.includes('"--test"'),
      "The concealment mutation must remove the literal nested-run flag"
    );
    await assertMutationRejected(
      { qualityOverrides: { [regressionTargetFile]: concealed } },
      /must list exactly the tests\/quality modules that spawn a nested node --test run/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested spawner dropped from the inventory",
  async () => {
    const shortenedInventory = replaceOnce(
      guardSource,
      `  ${JSON.stringify(regressionTargetFile)},\n`,
      ""
    );

    await assertMutationRejected(
      { guard: shortenedInventory },
      /must list exactly the tests\/quality modules that spawn a nested node --test run/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an unlisted nested spawner",
  async () => {
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "unlisted-nested-spawner.test.mjs": hiddenSpawnerSource
        }
      },
      /must list exactly the tests\/quality modules that spawn a nested node --test run/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a fixture writer that stops copying the shared helper",
  async () => {
    const fixtureWriterFile =
      "mobile-navigation-contracts-structure-mutations.test.mjs";
    const fixtureWriterSource = await readFile(
      path.join(qualityDirectory, fixtureWriterFile),
      "utf8"
    );
    const withoutHelperCopy = replaceOnce(
      fixtureWriterSource,
      ",\n      writeFile(\n        path.join(fixtureHelperDirectory, spawnHelperFile),\n        spawnHelperSource\n      )",
      ""
    );

    await assertMutationRejected(
      { qualityOverrides: { [fixtureWriterFile]: withoutHelperCopy } },
      /must copy tests\/helpers\/quality-spawn\.mjs into its isolated fixture root/
    );
  }
);
