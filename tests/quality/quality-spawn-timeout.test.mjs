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

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const spawnHelperFile = "quality-spawn.mjs";
const spawnHelperPath = path.join("tests/helpers", spawnHelperFile);
const spawnHelperUrl = pathToFileURL(path.join(repoRoot, spawnHelperPath)).href;
const workflowPath = ".github/workflows/quality-baseline.yml";
// This contract owns the timeout literals it exercises, so it is the one quality
// module exempt from the "no local spawn timeout" rule it enforces elsewhere.
const contractFile = "quality-spawn-timeout.test.mjs";
const nestedRunMarker = "\"--test\"";
const helperImportPattern =
  /import\s*\{([^}]*)\}\s*from\s*"\.\.\/helpers\/quality-spawn\.mjs";/g;
const expectedHelperImports = [
  "assertQualitySpawnCompleted",
  "qualitySpawnTimeoutMs"
];
const timeoutPropertyPattern = /\btimeout:\s*([^,\n}]+)/g;
const fixtureRootDeclaration =
  'const fixtureHelperDirectory = path.join(fixtureRoot, "tests/helpers");';
const legacyErrorAssertionPattern = /\bassert\.ifError\s*\(/g;
const spawnCallPattern = /\bspawnSync\s*\(/g;
const spawnAssertionPattern = /\bassertQualitySpawnCompleted\s*\(/g;
const fixtureHelperCopyPattern =
  /writeFile\(\s*path\.join\(fixtureHelperDirectory, spawnHelperFile\),\s*spawnHelperSource\s*\)/;
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

test(
  "nested quality-suite spawns share the reviewed spawn-timeout helper",
  async () => {
    const entries = await readdir(qualityDirectory, { withFileTypes: true });
    const moduleSources = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".test.mjs") &&
            entry.name !== contractFile
        )
        .map(async (entry) => [
          path.posix.join("tests/quality", entry.name),
          await readFile(path.join(qualityDirectory, entry.name), "utf8")
        ])
    );
    const nestedSpawners = moduleSources.filter(
      ([, source]) =>
        source.includes("spawnSync(") && source.includes(nestedRunMarker)
    );
    const fixtureWriters = moduleSources.filter(([, source]) =>
      source.includes(fixtureRootDeclaration)
    );
    const problems = [];

    assert.ok(
      nestedSpawners.length >= 10,
      `Expected the focused structure guards to still spawn nested quality runs; found ${nestedSpawners.length}`
    );
    assert.ok(
      fixtureWriters.length >= 7,
      `Expected the isolated mutation fixtures to still build fixture roots; found ${fixtureWriters.length}`
    );

    for (const [modulePath, source] of nestedSpawners) {
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

      const spawnCalls = countMatches(source, spawnCallPattern);
      if (countMatches(source, spawnAssertionPattern) < spawnCalls) {
        problems.push(
          `${modulePath} must route all ${spawnCalls} spawnSync result(s) through assertQualitySpawnCompleted`
        );
      }
    }

    for (const [modulePath, source] of fixtureWriters) {
      if (
        !source.includes(`const spawnHelperFile = "${spawnHelperFile}";`) ||
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
