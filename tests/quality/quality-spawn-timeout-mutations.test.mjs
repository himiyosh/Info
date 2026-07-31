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
const testsDirectory = path.join(repoRoot, "tests");
const spawnHelperFile = "quality-spawn.mjs";
const spawnHelperPath = "tests/helpers/quality-spawn.mjs";
const guardPath = "tests/quality/quality-spawn-timeout.test.mjs";
const regressionTargetPath =
  "tests/quality/asset-integrity-contracts-structure.test.mjs";
const regressionTargetLabel = "asset integrity inventory";
const fixtureWriterPath =
  "tests/quality/mobile-navigation-contracts-structure-mutations.test.mjs";
const nonNestedTargetPath = "tests/quality/merge-gate.test.mjs";
const workflowRelativePath = ".github/workflows/quality-baseline.yml";
// npm test already saturates a two-core runner with ten nested full-suite
// spawns, so each fixture run is restricted to the coverage contract, which
// reads sources and spawns nothing of its own.
const coverageTestName =
  "child process modules under tests share the reviewed spawn-timeout helper";
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
const inventoryMismatchMessage =
  /must together list exactly the tests modules that can start a child process/;
const classificationMessage =
  /is classified as a non-nested child process module/;
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
const spawnCallToken = ["spawnSync", "("].join("");
const concealedFlagDeclaration = `const concealedTestFlag = ${JSON.stringify("--te")} + ${JSON.stringify("st")};`;
const nestedSuiteSpawnLine = `${unspacedSpawnCall}, ["--test", "tests/quality/site-quality.test.mjs"]);`;
const unlistedLiteralFlagSource = [
  'import { spawnSync } from "node:child_process";',
  'import { test } from "node:test";',
  "",
  'test("an unlisted module spawns a nested quality run", () => {',
  `  ${nestedSuiteSpawnLine}`,
  "});",
  ""
].join("\n");
const unlistedIndirectFlagSource = [
  'import { spawnSync } from "node:child_process";',
  'import { test } from "node:test";',
  "",
  'test("an unlisted module builds its nested-run flag indirectly", () => {',
  `  ${concealedFlagDeclaration}`,
  `  ${[unspacedSpawnCall, ', [concealedTestFlag, "tests/quality/site-quality.test.mjs"]);'].join("")}`,
  "});",
  ""
].join("\n");
const unlistedAliasedImportSource = [
  'import { spawnSync as run } from "node:child_process";',
  'import { test } from "node:test";',
  "",
  'test("an unlisted module aliases the child process API", () => {',
  '  if (typeof run !== "function") {',
  '    throw new Error("child process API missing");',
  "  }",
  "});",
  ""
].join("\n");
const unlistedBareSpecifierSource = [
  'import { spawnSync as run } from "child_process";',
  'import { test } from "node:test";',
  "",
  'test("an unlisted module imports the legacy child process specifier", () => {',
  `  ${concealedFlagDeclaration}`,
  '  run(process.execPath, [concealedTestFlag, "tests/quality/site-quality.test.mjs"]);',
  "});",
  ""
].join("\n");
// The extracted-helper shape this repository would plausibly reach for next: the
// duplicated runTestModules() body moved out of the structure guards.
const unlistedSpawnHelperSource = [
  'import { spawnSync } from "node:child_process";',
  "",
  "export function runNestedQuality(files) {",
  `  return ${[unspacedSpawnCall, ', ["--test", ...files], { encoding: "utf8" });'].join("")}`,
  "}",
  ""
].join("\n");
const unlistedCommonJsSpawnHelperSource = [
  'const { spawnSync } = require("node:child_process");',
  "",
  "exports.runNestedQuality = function runNestedQuality(files) {",
  `  return ${[unspacedSpawnCall, ', ["--test", ...files], { encoding: "utf8" });'].join("")}`,
  "};",
  ""
].join("\n");
const unsupportedExtensionSource = [
  'import { spawnSync } from "node:child_process";',
  "",
  "export function runNestedQuality(files: string[]) {",
  `  return ${[unspacedSpawnCall, ', ["--test", ...files]);'].join("")}`,
  "}",
  ""
].join("\n");
const helperBackedSpawnerSource = [
  'import { test } from "node:test";',
  "",
  'import { runNestedQuality } from "../helpers/zz-quality-child-runner.mjs";',
  "",
  'test("a wrapper module runs the nested quality suite through a helper", () => {',
  '  runNestedQuality(["tests/quality/site-quality.test.mjs"]);',
  "});",
  ""
].join("\n");
const scriptBackedSpawnerSource = [
  'import { test } from "node:test";',
  "",
  'import { runNestedQuality } from "../helpers/zz-quality-child-runner.js";',
  "",
  'test("a wrapper module runs the nested quality suite through a script helper", () => {',
  '  runNestedQuality(["tests/quality/site-quality.test.mjs"]);',
  "});",
  ""
].join("\n");
// Ordinary argument construction: an environment-supplied flag and a joined
// path, so neither the nested-run flag nor the quality directory appears as a
// literal. Only the pinned call-site count catches this.
const indirectNonNestedSpawnLine = [
  unspacedSpawnCall,
  ', [process.env.INFO_EXTRA_FLAG, path.join("tests", "quality", "site-quality.test.mjs")]);'
].join("");

async function collectFiles(directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(path.join(directory, entry.name), entryPath);
      }
      return entry.isFile() ? [entryPath] : [];
    })
  );
  return collected.flat();
}

const [
  guardSource,
  regressionTargetSource,
  fixtureWriterSource,
  nonNestedTargetSource,
  spawnHelperSource,
  testsFixtureFiles
] = await Promise.all([
  readFile(path.join(repoRoot, guardPath), "utf8"),
  readFile(path.join(repoRoot, regressionTargetPath), "utf8"),
  readFile(path.join(repoRoot, fixtureWriterPath), "utf8"),
  readFile(path.join(repoRoot, nonNestedTargetPath), "utf8"),
  readFile(path.join(repoRoot, spawnHelperPath), "utf8"),
  collectFiles(testsDirectory, "tests")
]);

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
const linkFallbackCodes = new Set(["EXDEV", "EPERM", "ENOSYS", "EMLINK"]);

async function materialize(sourcePath, destinationPath) {
  try {
    await link(sourcePath, destinationPath);
  } catch (linkError) {
    if (!linkFallbackCodes.has(linkError.code)) {
      throw linkError;
    }
    await copyFile(sourcePath, destinationPath);
  }
}

async function runGuardMutation({
  guard = guardSource,
  overrides = {},
  extraFiles = {}
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-quality-spawn-guard-")
  );
  const fixtureHelperDirectory = path.join(fixtureRoot, "tests/helpers");
  const writtenFiles = {
    [guardPath]: guard,
    ...overrides,
    ...extraFiles
  };
  const linkedFiles = testsFixtureFiles.filter(
    (filePath) =>
      filePath !== spawnHelperPath && !Object.hasOwn(writtenFiles, filePath)
  );

  try {
    for (const filePath of [
      ...linkedFiles,
      ...Object.keys(writtenFiles),
      workflowRelativePath
    ]) {
      assert.ok(
        !path.posix.isAbsolute(filePath) && !filePath.includes(".."),
        `Fixture paths must stay inside the fixture root: ${filePath}`
      );
      await mkdir(path.join(fixtureRoot, path.dirname(filePath)), {
        recursive: true
      });
    }
    await mkdir(fixtureHelperDirectory, { recursive: true });
    await Promise.all([
      materialize(
        path.join(repoRoot, workflowRelativePath),
        path.join(fixtureRoot, workflowRelativePath)
      ),
      ...linkedFiles.map((filePath) =>
        materialize(
          path.join(repoRoot, filePath),
          path.join(fixtureRoot, filePath)
        )
      )
    ]);
    await Promise.all([
      writeFile(
        path.join(fixtureHelperDirectory, spawnHelperFile),
        spawnHelperSource
      ),
      ...Object.entries(writtenFiles).map(([filePath, source]) =>
        writeFile(path.join(fixtureRoot, filePath), source)
      )
    ]);

    const result = spawnSync(
      process.execPath,
      [
        "--test",
        `--test-name-pattern=^${coverageTestName}$`,
        guardPath
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
      { overrides: { [regressionTargetPath]: requoted } },
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
      { overrides: { [regressionTargetPath]: spaced } },
      /must not hardcode a spawn timeout/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an inventoried spawner that obscures its nested-run flag",
  async () => {
    const concealed = replaceOnce(
      replaceOnce(
        regressedTargetSource,
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
      { overrides: { [regressionTargetPath]: concealed } },
      /must not hardcode a spawn timeout/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a child process module dropped from the inventory",
  async () => {
    const shortenedInventory = replaceOnce(
      guardSource,
      `  ${JSON.stringify(regressionTargetPath)},\n`,
      ""
    );

    await assertMutationRejected(
      { guard: shortenedInventory },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an unlisted module that spawns with a literal flag",
  async () => {
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/quality/unlisted-literal-spawner.test.mjs":
            unlistedLiteralFlagSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an unlisted module that builds its nested-run flag indirectly",
  async () => {
    assert.ok(
      !unlistedIndirectFlagSource.includes('"--test"'),
      "The indirect-flag fixture must not contain a literal nested-run flag"
    );
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/quality/unlisted-indirect-spawner.test.mjs":
            unlistedIndirectFlagSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an unlisted module that only aliases the child process API",
  async () => {
    assert.ok(
      !unlistedAliasedImportSource.includes(spawnCallToken),
      "The aliased-import fixture must not contain a direct spawnSync call site"
    );
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/quality/unlisted-aliased-spawner.test.mjs":
            unlistedAliasedImportSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects an unlisted module that uses the legacy child process specifier",
  async () => {
    assert.ok(
      !unlistedBareSpecifierSource.includes("node:child_process"),
      "The legacy-specifier fixture must import without the node: prefix"
    );
    assert.ok(
      !unlistedBareSpecifierSource.includes(spawnCallToken),
      "The legacy-specifier fixture must not contain a direct spawnSync call site"
    );
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/quality/unlisted-legacy-specifier-spawner.test.mjs":
            unlistedBareSpecifierSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested run extracted into an unlisted tests/helpers module",
  async () => {
    assert.ok(
      !helperBackedSpawnerSource.includes("child_process") &&
        !helperBackedSpawnerSource.includes(spawnCallToken),
      "The wrapper fixture must delegate its child process to the helper"
    );
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/helpers/zz-quality-child-runner.mjs":
            unlistedSpawnHelperSource,
          "tests/quality/zz-wrapper-spawner.test.mjs": helperBackedSpawnerSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested run extracted into a new tests subdirectory",
  async () => {
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/support/zz-quality-child-runner.mjs": unlistedSpawnHelperSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested run extracted into an unlisted tests/helpers script",
  async () => {
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/helpers/zz-quality-child-runner.js": unlistedSpawnHelperSource,
          "tests/quality/zz-script-spawner.test.mjs": scriptBackedSpawnerSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a nested run extracted into an unlisted CommonJS helper",
  async () => {
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/helpers/zz-quality-child-runner.cjs":
            unlistedCommonJsSpawnHelperSource
        }
      },
      inventoryMismatchMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard fails closed on a script extension it does not scan",
  async () => {
    await assertMutationRejected(
      {
        extraFiles: {
          "tests/helpers/zz-quality-child-runner.mts": unsupportedExtensionSource
        }
      },
      /uses the \.mts script extension, which this contract does not scan/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a non-nested module that starts spawning the quality suite",
  async () => {
    const promotedToNested = `${nonNestedTargetSource.trimEnd()}\n\n${nestedSuiteSpawnLine}\n`;

    await assertMutationRejected(
      { overrides: { [nonNestedTargetPath]: promotedToNested } },
      classificationMessage
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a non-nested module that gains an indirectly built spawn",
  async () => {
    const extraSpawn = `${nonNestedTargetSource.trimEnd()}\n\n${indirectNonNestedSpawnLine}\n`;

    assert.ok(
      !indirectNonNestedSpawnLine.includes('"--test"') &&
        !indirectNonNestedSpawnLine.includes("tests/quality"),
      "The indirect mutation must be caught by the pinned call-site count alone"
    );
    await assertMutationRejected(
      { overrides: { [nonNestedTargetPath]: extraSpawn } },
      /reviewed call site\(s\), but it now has/
    );
  }
);

mutationTest(
  "spawn-timeout guard rejects a fixture writer that stops copying the shared helper",
  async () => {
    const withoutHelperCopy = replaceOnce(
      fixtureWriterSource,
      ",\n      writeFile(\n        path.join(fixtureHelperDirectory, spawnHelperFile),\n        spawnHelperSource\n      )",
      ""
    );

    await assertMutationRejected(
      { overrides: { [fixtureWriterPath]: withoutHelperCopy } },
      /must copy tests\/helpers\/quality-spawn\.mjs into its isolated fixture root/
    );
  }
);
