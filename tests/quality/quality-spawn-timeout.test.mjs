import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertQualitySpawnCompleted,
  defaultQualitySpawnTimeoutMs,
  qualitySpawnTimeoutEnvironmentName,
  qualitySpawnTimeoutMs,
  resolveQualitySpawnTimeoutMs
} from "../helpers/quality-spawn.mjs";

// This guard is a source scanner. It exists to catch accidental regressions,
// such as a contributor reintroducing a per-file spawn timeout or moving a
// nested run behind a new helper; it cannot stop a contributor who deliberately
// obfuscates a module's own child_process usage. Spelling is not obfuscation, so
// a bare "child_process" specifier is detected exactly like "node:child_process",
// and the whole tests/ tree is walked recursively rather than a fixed list of
// directories, because the next extracted helper may live anywhere under it.
const repoRoot = process.cwd();
const testsDirectory = path.join(repoRoot, "tests");
const spawnHelperFile = "quality-spawn.mjs";
const spawnHelperPath = path.posix.join("tests/helpers", spawnHelperFile);
const spawnHelperUrl = pathToFileURL(path.join(repoRoot, spawnHelperPath)).href;
const workflowPath = ".github/workflows/quality-baseline.yml";
// This contract owns the timeout literals it exercises, so it is the one tests/
// module exempt from the rules it enforces. Never widen the exemption: every
// other module that can start a child process, including this contract's own
// mutation fixture, is inventoried and checked.
const contractPath = "tests/quality/quality-spawn-timeout.test.mjs";
// Authoritative inventory. Every tests/ module that can start a child process
// must appear in exactly one of these two lists, and detection below must
// reproduce their union exactly. Adding such a module, deleting one, moving the
// capability into a new helper, or obscuring how it builds its arguments all
// fail this contract until the inventory is updated deliberately.
const nestedSpawnerFiles = [
  "tests/quality/asset-integrity-contracts-structure-mutations.test.mjs",
  "tests/quality/asset-integrity-contracts-structure.test.mjs",
  "tests/quality/baseline-motion-safety-structure-mutations.test.mjs",
  "tests/quality/baseline-motion-safety-structure.test.mjs",
  "tests/quality/focus-contrast-contracts-structure-mutations.test.mjs",
  "tests/quality/focus-contrast-contracts-structure.test.mjs",
  "tests/quality/localization-contracts-structure.test.mjs",
  "tests/quality/mobile-navigation-contracts-structure-mutations.test.mjs",
  "tests/quality/mobile-navigation-contracts-structure.test.mjs",
  "tests/quality/project-catalogue-structure-mutations.test.mjs",
  "tests/quality/project-catalogue-structure.test.mjs",
  "tests/quality/public-discovery-contracts-structure-mutations.test.mjs",
  "tests/quality/public-discovery-contracts-structure.test.mjs",
  "tests/quality/publishing-integrity-structure.test.mjs",
  "tests/quality/quality-spawn-timeout-mutations.test.mjs",
  "tests/quality/reduced-motion-contracts-structure-mutations.test.mjs",
  "tests/quality/reduced-motion-contracts-structure.test.mjs",
  "tests/quality/workflow-security-structure.test.mjs"
];
// Modules that start child processes for something other than a nested quality
// suite. They are classified, not exempted: each entry states what it runs, and
// the classification itself is verified below, so one of these cannot quietly
// become a nested spawner.
const nonNestedSpawnerFiles = [
  // Launches a headless Chrome binary; the shared browser-journey driver.
  "tests/helpers/chrome-journey.mjs",
  // Runs scripts/generate-static-pages.mjs --check, the generated-page drift
  // checker, through promisified execFile.
  "tests/quality/bilingual-static.test.mjs",
  // Runs scripts/check-independent-review.mjs, the review-marker CLI.
  "tests/quality/independent-review-evidence.test.mjs",
  // Runs scripts/check-merge-gate.mjs, the snapshot merge-gate CLI.
  "tests/quality/merge-gate.test.mjs",
  // Launches a headless Chrome binary to exercise the print stylesheet.
  "tests/quality/print-portfolio.test.mjs"
];
const childProcessFiles = [
  ...nestedSpawnerFiles,
  ...nonNestedSpawnerFiles
].sort();
const fixtureWriterFiles = [
  "tests/quality/asset-integrity-contracts-structure-mutations.test.mjs",
  "tests/quality/baseline-motion-safety-structure-mutations.test.mjs",
  "tests/quality/focus-contrast-contracts-structure-mutations.test.mjs",
  "tests/quality/mobile-navigation-contracts-structure-mutations.test.mjs",
  "tests/quality/project-catalogue-structure-mutations.test.mjs",
  "tests/quality/public-discovery-contracts-structure-mutations.test.mjs",
  "tests/quality/quality-spawn-timeout-mutations.test.mjs",
  "tests/quality/reduced-motion-contracts-structure-mutations.test.mjs"
];
// Detection is on the ability to start a child process, not on how the child's
// arguments are spelled: any child_process specifier (static, aliased,
// namespaced, or dynamic) or any call to the spawn/exec/fork family requires an
// inventory entry. Bare `exec(` is intentionally omitted because RegExp#exec
// dominates it; importing `exec` still matches the specifier pattern.
const childProcessSpecifierPattern = /['"](?:node:)?child_process['"]/;
const childProcessCallPattern =
  /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|fork)\s*\(/;
const spawnCallCountPattern = /\bspawnSync\s*\(/g;
const nestedRunFlagPattern = /['"]--test['"]/;
const qualitySuiteReferencePattern = /tests\/quality/;
const fixtureRootPattern =
  /\bconst\s+fixtureHelperDirectory\s*=\s*path\.join\(\s*fixtureRoot\s*,\s*['"]tests\/helpers['"]\s*\)/;
const helperImportPattern =
  /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/helpers\/quality-spawn\.mjs['"]/g;
const expectedHelperImports = [
  "assertQualitySpawnCompleted",
  "qualitySpawnTimeoutMs"
];
const timeoutPropertyPattern = /\btimeout\s*:\s*([^,\n}]+)/g;
const legacyErrorAssertionPattern = /\bassert\s*\.\s*ifError\s*\(/g;
const spawnAssertionPattern = /\bassertQualitySpawnCompleted\s*\(/g;
const spawnHelperNamePattern =
  /\bconst\s+spawnHelperFile\s*=\s*['"]quality-spawn\.mjs['"]\s*;/;
const fixtureHelperCopyPattern =
  /writeFile\(\s*path\.join\(\s*fixtureHelperDirectory\s*,\s*spawnHelperFile\s*\)\s*,\s*spawnHelperSource\s*\)/;
const jobBudgetPattern = /^\s*timeout-minutes:\s*(\d+)\s*$/gm;
// The nested full-suite runs timed out at this budget on the two-core CI runner
// (Quality baseline run 30548611558 failed twice with spawnSync ETIMEDOUT).
const regressedSpawnTimeoutMs = 60_000;
const acceptedOverrides = [
  [undefined, defaultQualitySpawnTimeoutMs],
  ["1", 1],
  ["45000", 45_000],
  [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]
];
const rejectedOverrides = [
  "",
  "0",
  "-1",
  "1.5",
  "1e5",
  "0x2710",
  "+45000",
  "045000",
  " 45000 ",
  "45000ms",
  "Infinity",
  "NaN",
  String(Number.MAX_SAFE_INTEGER + 2)
];

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

async function readModuleSources(directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return readModuleSources(path.join(directory, entry.name), entryPath);
      }
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".mjs") ||
        entryPath === contractPath
      ) {
        return [];
      }
      return [
        [entryPath, await readFile(path.join(directory, entry.name), "utf8")]
      ];
    })
  );
  return collected.flat();
}

test(
  "child process modules under tests share the reviewed spawn-timeout helper",
  async () => {
    const moduleSources = new Map(
      await readModuleSources(testsDirectory, "tests")
    );
    const detectedChildProcessModules = [...moduleSources]
      .filter(
        ([, source]) =>
          childProcessSpecifierPattern.test(source) ||
          childProcessCallPattern.test(source)
      )
      .map(([modulePath]) => modulePath)
      .sort();
    const detectedFixtureWriters = [...moduleSources]
      .filter(([, source]) => fixtureRootPattern.test(source))
      .map(([modulePath]) => modulePath)
      .sort();

    assert.deepEqual(
      detectedChildProcessModules,
      childProcessFiles,
      "nestedSpawnerFiles and nonNestedSpawnerFiles must together list exactly the tests modules that can start a child process, wherever under tests they live; a module that starts one without an inventory entry is hiding from this contract, not exempt from it"
    );
    assert.deepEqual(
      detectedFixtureWriters,
      fixtureWriterFiles,
      "fixtureWriterFiles must list exactly the tests modules that build an isolated fixture root"
    );

    const problems = [];

    for (const modulePath of nestedSpawnerFiles) {
      const source = moduleSources.get(modulePath);
      assert.ok(source, `Missing inventoried nested spawner: ${modulePath}`);

      const importNames = [...source.matchAll(helperImportPattern)].map(
        (match) =>
          match[1]
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
            .sort()
      );
      if (
        importNames.length !== 1 ||
        importNames[0].join(",") !== expectedHelperImports.join(",")
      ) {
        problems.push(
          `${modulePath} must import exactly {${expectedHelperImports.join(", ")}} once from ${spawnHelperPath}`
        );
      }

      const localTimeouts = [...source.matchAll(timeoutPropertyPattern)]
        .map((match) => match[1].trim())
        .filter((value) => value !== "qualitySpawnTimeoutMs");
      if (localTimeouts.length > 0) {
        problems.push(
          `${modulePath} must not hardcode a spawn timeout; replace ${localTimeouts.join(", ")} with qualitySpawnTimeoutMs`
        );
      }

      if (countMatches(source, legacyErrorAssertionPattern) > 0) {
        problems.push(
          `${modulePath} must not report spawn failures through assert.ifError, which hides ETIMEDOUT behind an opaque message`
        );
      }

      const spawnCalls = countMatches(source, spawnCallCountPattern);
      if (countMatches(source, spawnAssertionPattern) < spawnCalls) {
        problems.push(
          `${modulePath} must route all ${spawnCalls} spawnSync result(s) through assertQualitySpawnCompleted`
        );
      }
    }

    for (const modulePath of nonNestedSpawnerFiles) {
      const source = moduleSources.get(modulePath);
      assert.ok(source, `Missing inventoried non-nested spawner: ${modulePath}`);

      if (
        nestedRunFlagPattern.test(source) ||
        qualitySuiteReferencePattern.test(source)
      ) {
        problems.push(
          `${modulePath} is classified as a non-nested child process module, but it now passes a nested-run flag or names the quality suite directory; move it to nestedSpawnerFiles so the shared spawn budget applies`
        );
      }
    }

    for (const modulePath of fixtureWriterFiles) {
      const source = moduleSources.get(modulePath);
      assert.ok(source, `Missing inventoried fixture writer: ${modulePath}`);

      if (
        !spawnHelperNamePattern.test(source) ||
        !fixtureHelperCopyPattern.test(source)
      ) {
        problems.push(
          `${modulePath} must copy ${spawnHelperPath} into its isolated fixture root so the copied guard can import it`
        );
      }
    }

    assert.deepEqual(
      problems,
      [],
      `Centralize the nested quality-suite spawn budget:\n- ${problems.join("\n- ")}`
    );
  }
);

test(
  "the default quality spawn budget fits inside the CI job budget",
  async () => {
    const workflowSource = await readFile(
      path.join(repoRoot, workflowPath),
      "utf8"
    );
    const jobBudgets = [...workflowSource.matchAll(jobBudgetPattern)].map(
      (match) => Number(match[1])
    );

    assert.deepEqual(
      jobBudgets.length,
      1,
      `${workflowPath} must declare exactly one timeout-minutes budget for this contract to compare against`
    );

    const jobBudgetMs = jobBudgets[0] * 60_000;

    assert.ok(
      Number.isSafeInteger(qualitySpawnTimeoutMs) && qualitySpawnTimeoutMs > 0,
      `${spawnHelperPath} must resolve a positive safe-integer millisecond budget; received ${qualitySpawnTimeoutMs}`
    );
    assert.ok(
      defaultQualitySpawnTimeoutMs > regressedSpawnTimeoutMs,
      `The default spawn budget must exceed the ${regressedSpawnTimeoutMs} ms budget that timed out on CI; received ${defaultQualitySpawnTimeoutMs}`
    );
    assert.ok(
      defaultQualitySpawnTimeoutMs * 2 <= jobBudgetMs,
      `The default spawn budget (${defaultQualitySpawnTimeoutMs} ms) must leave the ${workflowPath} job (${jobBudgetMs} ms) room to report the failure`
    );
  }
);

test(
  "the quality spawn budget is environment-overridable and fail-closed",
  () => {
    for (const [rawValue, expected] of acceptedOverrides) {
      assert.equal(
        resolveQualitySpawnTimeoutMs(rawValue),
        expected,
        `${qualitySpawnTimeoutEnvironmentName}=${JSON.stringify(rawValue)} must resolve to ${expected}`
      );
    }

    for (const rawValue of [...rejectedOverrides, 45_000, null]) {
      assert.throws(
        () => resolveQualitySpawnTimeoutMs(rawValue),
        (thrown) =>
          thrown instanceof TypeError &&
          thrown.message.includes(qualitySpawnTimeoutEnvironmentName) &&
          thrown.message.includes(JSON.stringify(rawValue)),
        `${qualitySpawnTimeoutEnvironmentName}=${JSON.stringify(rawValue)} must fail closed with a TypeError naming the variable`
      );
    }
  }
);

test(
  "an unusable spawn budget fails the importing module instead of silently defaulting",
  () => {
    const rejected = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `import ${JSON.stringify(spawnHelperUrl)};`],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NO_COLOR: "1",
          [qualitySpawnTimeoutEnvironmentName]: "not-a-number"
        },
        timeout: 30_000
      }
    );

    assert.notEqual(
      rejected.status,
      0,
      `Importing ${spawnHelperPath} with an unusable ${qualitySpawnTimeoutEnvironmentName} must fail`
    );
    assert.match(rejected.stderr, /TypeError/);
    assert.match(
      rejected.stderr,
      new RegExp(qualitySpawnTimeoutEnvironmentName)
    );
  }
);

test(
  "quality spawn assertions explain timeouts and preserve other spawn failures",
  () => {
    const completed = spawnSync(process.execPath, ["--eval", ""], {
      encoding: "utf8",
      timeout: 30_000
    });
    assert.equal(
      assertQualitySpawnCompleted(completed, "a completed run"),
      undefined,
      "A completed spawn must not raise"
    );

    const timedOut = spawnSync(
      process.execPath,
      ["--eval", "setTimeout(() => {}, 30_000);"],
      { encoding: "utf8", timeout: 50 }
    );
    assert.equal(
      timedOut.error?.code,
      "ETIMEDOUT",
      "The fixture spawn must actually time out for this contract to be meaningful"
    );
    assert.throws(
      () => assertQualitySpawnCompleted(timedOut, "the sample nested run"),
      (thrown) =>
        thrown.message.includes("the sample nested run") &&
        thrown.message.includes(String(qualitySpawnTimeoutMs)) &&
        thrown.message.includes(qualitySpawnTimeoutEnvironmentName) &&
        thrown.message.includes("timeout") &&
        thrown.cause?.code === "ETIMEDOUT",
      "A timed-out spawn must name the run, the elapsed budget, and the override variable"
    );

    const missingBinary = spawnSync("info-quality-spawn-missing-binary", [], {
      encoding: "utf8",
      timeout: 30_000
    });
    assert.equal(
      missingBinary.error?.code,
      "ENOENT",
      "The fixture spawn must actually fail to launch for this contract to be meaningful"
    );
    assert.throws(
      () => assertQualitySpawnCompleted(missingBinary, "a launch failure"),
      (thrown) =>
        thrown.message.includes("ENOENT") &&
        !thrown.message.includes(qualitySpawnTimeoutEnvironmentName),
      "A non-timeout spawn failure must keep reporting its own cause"
    );
  }
);
