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
const guardFile = "reduced-motion-contracts-structure.test.mjs";
const mutationGuardFile =
  "reduced-motion-contracts-structure-mutations.test.mjs";
const reducedMotionFile = "reduced-motion-contracts.test.mjs";
const monolithFile = "site-quality.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY",
  "INFO_BASELINE_MOTION_SAFETY_INVENTORY",
  "INFO_REDUCED_MOTION_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = ["modern.css", "script.js", "styles.css"];
const [
  boundaryAuthoritySource,
  guardSource,
  mutationGuardSource,
  reducedMotionSource,
  monolithSource
] = await Promise.all([
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, reducedMotionFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const reducedMotionTestNames = [
  ...reducedMotionSource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const reducedMotionBodyStart = reducedMotionSource.indexOf(
  `test(${JSON.stringify(reducedMotionTestNames[0])}`
);
const reducedMotionHeader = reducedMotionSource.slice(
  0,
  reducedMotionBodyStart
);
const reducedMotionBodyBytes =
  Buffer.byteLength(reducedMotionSource) - reducedMotionBodyStart;
const adjacentMonolithTestNames = [
  "micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion",
  "final modern focus-ring overrides match the actual project and contact surfaces",
  "focus-ring / backdrop token pairings meet WCAG 1.4.11 non-text contrast (>= 3:1)"
];
const adjacentMonolithHelperNames = [
  "parseOklchTokens",
  "relativeLuminanceFromOklch",
  "oklchContrastRatio"
];

assert.equal(
  reducedMotionTestNames.length,
  2,
  "Mutation fixtures require the fixed two-test inventory"
);
assert.notEqual(
  reducedMotionBodyStart,
  -1,
  "Mutation fixtures require the reduced-motion body boundary"
);
const monolithFixtureSource = padWithComment(
  [
    'import { test } from "node:test";',
    "",
    ...adjacentMonolithTestNames.map(
      (testName) => `test(${JSON.stringify(testName)}, () => {});`
    ),
    "",
    ...adjacentMonolithHelperNames.map(
      (helperName) => `function ${helperName}() {}`
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
  reducedMotion = reducedMotionSource,
  extraQualityFiles = {},
  mutationGuard = mutationGuardSource,
  monolith = monolithFixtureSource
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-reduced-motion-guard-")
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
        path.join(fixtureQualityDirectory, reducedMotionFile),
        reducedMotion
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
  "reduced motion structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "reduced motion structure guard rejects canonical names leaking into the monolith",
  async () => {
    const paddingStart = monolithFixtureSource.lastIndexOf("/*");
    assert.notEqual(paddingStart, -1, "Monolith fixture must retain its padding");
    const canonicalNameLeak = padWithComment(
      [
        monolithFixtureSource.slice(0, paddingStart),
        `const leakedCanonicalName = ${JSON.stringify(reducedMotionTestNames[0])};`,
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
      /must exclusively own the two canonical reduced-motion contracts/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects adjacent monolith contracts leaking into the focused module",
  async () => {
    const reviewedAssertionMessage = JSON.stringify(
      "Reduced motion must define one combined rule for .wordmark-mark and .site-header.is-compact .wordmark-mark"
    );
    const adjacentContractLeak = replaceOncePreservingBytes(
      reducedMotionSource,
      reviewedAssertionMessage,
      JSON.stringify(adjacentMonolithTestNames[0])
    );
    assert.equal(
      Buffer.byteLength(adjacentContractLeak),
      Buffer.byteLength(reducedMotionSource)
    );
    await assertMutationRejected(
      { reducedMotion: adjacentContractLeak },
      /adjacent parallax and focus contracts must remain exclusively in the monolith/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects OKLCH helpers leaking into the focused module",
  async () => {
    const reviewedComment =
      "  // Idempotency: repeated arm calls must not attach duplicate listeners";
    const helperDefinitionLeak = replaceOncePreservingBytes(
      reducedMotionSource,
      reviewedComment,
      `  function ${adjacentMonolithHelperNames[0]}() {}`
    );
    assert.equal(
      Buffer.byteLength(helperDefinitionLeak),
      Buffer.byteLength(reducedMotionSource)
    );
    await assertMutationRejected(
      { reducedMotion: helperDefinitionLeak },
      /OKLCH contrast helpers must remain exclusively in the monolith/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects computed duplicate registrations",
  async () => {
    const duplicateRegistration = appendSource(
      reducedMotionSource,
      [
        `const duplicateReducedMotionName = ${JSON.stringify(reducedMotionTestNames[0])};`,
        "test(duplicateReducedMotionName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { reducedMotion: duplicateRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects dynamically assembled duplicate registrations",
  async () => {
    const splitMarker = ": a runtime change ";
    const [namePrefix, nameSuffix] = reducedMotionTestNames[1].split(splitMarker);
    assert.ok(nameSuffix, "Dynamic duplicate needs a stable split point");
    const dynamicDuplicate = appendSource(
      reducedMotionSource,
      [
        `const dynamicReducedMotionName = ${JSON.stringify(`${namePrefix}: a runtime`)} + ${JSON.stringify(` change ${nameSuffix}`)};`,
        "test(dynamicReducedMotionName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { reducedMotion: dynamicDuplicate },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects hidden global duplicates",
  async () => {
    const hiddenName = reducedMotionTestNames[0];
    const separator = ", disables ";
    const separatorIndex = hiddenName.indexOf(separator);
    assert.notEqual(separatorIndex, -1, "Hidden duplicate needs a split point");
    const namePrefix = hiddenName.slice(0, separatorIndex);
    const nameSuffix = hiddenName.slice(separatorIndex + separator.length);
    const hiddenDuplicate = [
      'import { test as registerTest } from "node:test";',
      "",
      `const hiddenReducedMotionName = ${JSON.stringify(`${namePrefix}, disables`)} + ${JSON.stringify(` ${nameSuffix}`)};`,
      "registerTest(hiddenReducedMotionName, () => {});",
      ""
    ].join("\n");
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "hidden-reduced-motion-duplicate.test.mjs": hiddenDuplicate
        }
      },
      /canonical reduced-motion test names must be registered exactly once globally/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects skipped canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(reducedMotionTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        reducedMotion: replaceOnce(
          reducedMotionSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.skip(")
        )
      },
      /must execute both contracts without skip or todo/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects todo canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(reducedMotionTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        reducedMotion: replaceOnce(
          reducedMotionSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.todo(")
        )
      },
      /must execute both contracts without skip or todo/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects exclusive canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(reducedMotionTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        reducedMotion: replaceOnce(
          reducedMotionSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.only(")
        )
      },
      /must not register test\.only or an only option/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects runtime-disabled canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(reducedMotionTestNames[0])}, async () => {`;
    const disabledRegistration =
      `test(${JSON.stringify(reducedMotionTestNames[0])}, { skip: true }, async () => {`;
    await assertMutationRejected(
      {
        reducedMotion: replaceOnce(
          reducedMotionSource,
          firstRegistration,
          disabledRegistration
        )
      },
      /must execute both contracts without skip or todo/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects focused-module padding",
  async () => {
    await assertMutationRejected(
      { reducedMotion: `${reducedMotionSource} ` },
      /reduced-motion-contracts\.test\.mjs must be exactly 5080 bytes/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects monolith padding",
  async () => {
    await assertMutationRejected(
      { monolith: `${monolithFixtureSource} ` },
      /site-quality\.test\.mjs must be exactly 38714 bytes/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects a same-length inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      reducedMotionBodyStart - 1
    )}\n`;
    const headerWrapperBypass =
      `${inertHeader}${reducedMotionSource.slice(reducedMotionBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(reducedMotionSource)
    );
    assert.equal(
      headerWrapperBypass.slice(reducedMotionBodyStart),
      reducedMotionSource.slice(reducedMotionBodyStart)
    );

    await assertMutationRejected(
      { reducedMotion: headerWrapperBypass },
      /reduced-motion-contracts\.test\.mjs header SHA-256 must match the reviewed extraction/
    );
  }
);

mutationTest(
  "reduced motion structure guard rejects empty stubs plus unrelated extraction",
  async () => {
    const stubBody = [
      ...reducedMotionTestNames.map(
        (name) => `test(${JSON.stringify(name)}, () => {});`
      ),
      "",
      "const unrelatedColorContrastExtraction = true;",
      ""
    ].join("\n");
    const unrelatedExtraction =
      `${reducedMotionHeader}${padWithComment(stubBody, reducedMotionBodyBytes)}`;

    assert.equal(
      Buffer.byteLength(unrelatedExtraction),
      Buffer.byteLength(reducedMotionSource)
    );

    await assertMutationRejected(
      { reducedMotion: unrelatedExtraction },
      /assertion body SHA-256/
    );
  }
);

mutationTest(
  "reduced motion structure guard binds skipped mutation callbacks",
  async () => {
    const wrapperMarker = [
      "mutationTest(",
      '  "reduced motion structure guard accepts the reviewed unchanged extraction",',
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
          "\n    const hiddenCanonicalName = reducedMotionTestNames[0].slice(0);" +
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
