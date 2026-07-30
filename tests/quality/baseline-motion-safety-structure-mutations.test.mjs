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
const guardFile = "baseline-motion-safety-structure.test.mjs";
const mutationGuardFile =
  "baseline-motion-safety-structure-mutations.test.mjs";
const baselineMotionSafetyFile = "baseline-motion-safety.test.mjs";
const monolithFile = "site-quality.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY",
  "INFO_BASELINE_MOTION_SAFETY_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = ["script.js", "styles.css"];
const [
  boundaryAuthoritySource,
  guardSource,
  mutationGuardSource,
  baselineMotionSafetySource,
  monolithSource
] = await Promise.all([
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, baselineMotionSafetyFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const baselineMotionSafetyTestNames = [
  ...baselineMotionSafetySource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const baselineMotionSafetyBodyStart = baselineMotionSafetySource.indexOf(
  `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}`
);
const baselineMotionSafetyHeader = baselineMotionSafetySource.slice(
  0,
  baselineMotionSafetyBodyStart
);
const baselineMotionSafetyBodyBytes =
  Buffer.byteLength(baselineMotionSafetySource) -
  baselineMotionSafetyBodyStart;
const adjacentMonolithTestNames = [
  "index.html IDs are unique and internal anchors are valid",
  "Japanese hero keeps each supplied phrase intact before the narrow emergency override"
];

assert.equal(
  baselineMotionSafetyTestNames.length,
  3,
  "Mutation fixtures require the fixed three-test inventory"
);
assert.notEqual(
  baselineMotionSafetyBodyStart,
  -1,
  "Mutation fixtures require the baseline motion-safety body boundary"
);
const monolithFixtureSource = padWithComment(
  [
    'import { test } from "node:test";',
    "",
    ...adjacentMonolithTestNames.map(
      (testName) => `test(${JSON.stringify(testName)}, () => {});`
    ),
    ""
  ].join("\n"),
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

function replaceOncePreservingBytes(source, marker, replacement) {
  const remainingBytes =
    Buffer.byteLength(marker) - Buffer.byteLength(replacement);
  assert.ok(
    remainingBytes >= 0,
    "Mutation replacement must not exceed its reviewed marker"
  );
  return replaceOnce(
    source,
    marker,
    `${replacement}${" ".repeat(remainingBytes)}`
  );
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
  baselineMotionSafety = baselineMotionSafetySource,
  extraQualityFiles = {},
  mutationGuard = mutationGuardSource,
  monolith = monolithFixtureSource
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-baseline-motion-safety-guard-")
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
      writeFile(path.join(fixtureQualityDirectory, guardFile), guardSource),
      writeFile(
        path.join(fixtureQualityDirectory, mutationGuardFile),
        mutationGuard
      ),
      writeFile(
        path.join(fixtureQualityDirectory, baselineMotionSafetyFile),
        baselineMotionSafety
      ),
      writeFile(
        path.join(fixtureQualityDirectory, monolithFile),
        monolith
      ),
      writeFile(
        path.join(fixtureHelperDirectory, boundaryAuthorityFile),
        boundaryAuthoritySource
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
  "baseline motion safety structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "baseline motion safety structure guard rejects canonical names leaking into the monolith",
  async () => {
    const paddingStart = monolithFixtureSource.lastIndexOf("/*");
    assert.notEqual(paddingStart, -1, "Monolith fixture must retain its padding");
    const canonicalNameLeak = padWithComment(
      [
        monolithFixtureSource.slice(0, paddingStart),
        `const leakedCanonicalName = ${JSON.stringify(baselineMotionSafetyTestNames[0])};`,
        ""
      ].join("\n"),
      Buffer.byteLength(monolithFixtureSource)
    );
    assert.equal(
      Buffer.byteLength(canonicalNameLeak),
      Buffer.byteLength(monolithFixtureSource)
    );
    await assertMutationRejected(
      { monolith: canonicalNameLeak },
      /must exclusively own the three canonical baseline motion-safety contracts/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects adjacent monolith contracts leaking into the focused module",
  async () => {
    const reviewedAssertionMessage = JSON.stringify(
      "Reveal priming must be gated on both reduced-motion and IntersectionObserver support, re-evaluated per render"
    );
    const adjacentContractLeak = replaceOncePreservingBytes(
      baselineMotionSafetySource,
      reviewedAssertionMessage,
      JSON.stringify(adjacentMonolithTestNames[0])
    );
    assert.equal(
      Buffer.byteLength(adjacentContractLeak),
      Buffer.byteLength(baselineMotionSafetySource)
    );
    await assertMutationRejected(
      { baselineMotionSafety: adjacentContractLeak },
      /adjacent ID-anchor and Japanese-hero contracts must remain exclusively in the monolith/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects computed duplicate registrations",
  async () => {
    const duplicateRegistration = appendSource(
      baselineMotionSafetySource,
      [
        `const duplicateMotionSafetyName = ${JSON.stringify(baselineMotionSafetyTestNames[0])};`,
        "test(duplicateMotionSafetyName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { baselineMotionSafety: duplicateRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects dynamically assembled duplicate registrations",
  async () => {
    const [namePrefix, nameSuffix] =
      baselineMotionSafetyTestNames[1].split(" transitions");
    const dynamicDuplicate = appendSource(
      baselineMotionSafetySource,
      [
        `const dynamicMotionSafetyName = ${JSON.stringify(namePrefix)} + ${JSON.stringify(` transitions${nameSuffix}`)};`,
        "test(dynamicMotionSafetyName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { baselineMotionSafety: dynamicDuplicate },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects hidden global duplicates",
  async () => {
    const hiddenName = baselineMotionSafetyTestNames[2];
    const separator = " and ";
    const separatorIndex = hiddenName.indexOf(separator);
    assert.notEqual(separatorIndex, -1, "Hidden duplicate needs a split point");
    const namePrefix = hiddenName.slice(0, separatorIndex);
    const nameSuffix = hiddenName.slice(separatorIndex + separator.length);
    const hiddenDuplicate = [
      'import { test as registerTest } from "node:test";',
      "",
      `const hiddenMotionSafetyName = ${JSON.stringify(`${namePrefix} and`)} + ${JSON.stringify(` ${nameSuffix}`)};`,
      "registerTest(hiddenMotionSafetyName, () => {});",
      ""
    ].join("\n");
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "hidden-baseline-motion-safety-duplicate.test.mjs": hiddenDuplicate
        }
      },
      /canonical baseline motion-safety test names must be registered exactly once globally/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects skipped canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        baselineMotionSafety: replaceOnce(
          baselineMotionSafetySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.skip(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects todo canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        baselineMotionSafety: replaceOnce(
          baselineMotionSafetySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.todo(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects exclusive canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        baselineMotionSafety: replaceOnce(
          baselineMotionSafetySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.only(")
        )
      },
      /must not register test\.only or an only option/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects runtime-disabled canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}, async () => {`;
    const disabledRegistration =
      `test(${JSON.stringify(baselineMotionSafetyTestNames[0])}, { skip: true }, async () => {`;
    await assertMutationRejected(
      {
        baselineMotionSafety: replaceOnce(
          baselineMotionSafetySource,
          firstRegistration,
          disabledRegistration
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects focused-module padding",
  async () => {
    await assertMutationRejected(
      { baselineMotionSafety: `${baselineMotionSafetySource} ` },
      /baseline-motion-safety\.test\.mjs must be exactly 5142 bytes/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects monolith padding",
  async () => {
    await assertMutationRejected(
      { monolith: `${monolithFixtureSource} ` },
      /site-quality\.test\.mjs must be exactly 38714 bytes/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects a same-length inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      baselineMotionSafetyBodyStart - 1
    )}\n`;
    const headerWrapperBypass =
      `${inertHeader}${baselineMotionSafetySource.slice(baselineMotionSafetyBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(baselineMotionSafetySource)
    );
    assert.equal(
      headerWrapperBypass.slice(baselineMotionSafetyBodyStart),
      baselineMotionSafetySource.slice(baselineMotionSafetyBodyStart)
    );

    await assertMutationRejected(
      { baselineMotionSafety: headerWrapperBypass },
      /baseline-motion-safety\.test\.mjs header SHA-256 must match the reviewed extraction/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard rejects empty stubs plus unrelated extraction",
  async () => {
    const stubBody = [
      ...baselineMotionSafetyTestNames.map(
        (name) => `test(${JSON.stringify(name)}, () => {});`
      ),
      "",
      "const unrelatedContactMotionExtraction = true;",
      ""
    ].join("\n");
    const unrelatedExtraction =
      `${baselineMotionSafetyHeader}${padWithComment(stubBody, baselineMotionSafetyBodyBytes)}`;

    assert.equal(
      Buffer.byteLength(unrelatedExtraction),
      Buffer.byteLength(baselineMotionSafetySource)
    );

    await assertMutationRejected(
      { baselineMotionSafety: unrelatedExtraction },
      /assertion body SHA-256/
    );
  }
);

mutationTest(
  "baseline motion safety structure guard binds skipped mutation callbacks",
  async () => {
    const wrapperMarker = [
      "mutationTest(",
      '  "baseline motion safety structure guard accepts the reviewed unchanged extraction",',
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
          "\n    const hiddenCanonicalName = baselineMotionSafetyTestNames[0].slice(0);" +
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
