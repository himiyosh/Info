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

import {
  assertQualitySpawnCompleted,
  qualitySpawnTimeoutMs
} from "../helpers/quality-spawn.mjs";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const helperDirectory = path.join(repoRoot, "tests/helpers");
const boundaryAuthorityFile = "site-quality-boundary.mjs";
const spawnHelperFile = "quality-spawn.mjs";
const guardFile = "focus-contrast-contracts-structure.test.mjs";
const mutationGuardFile =
  "focus-contrast-contracts-structure-mutations.test.mjs";
const focusContrastFile = "focus-contrast-contracts.test.mjs";
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
const runtimeFixturePaths = ["modern.css", "styles.css", "tokens.css"];
const [
  boundaryAuthoritySource,
  spawnHelperSource,
  guardSource,
  mutationGuardSource,
  focusContrastSource,
  monolithSource,
  modernSource,
  stylesSource,
  tokensSource
] = await Promise.all([
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(helperDirectory, spawnHelperFile), "utf8"),
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, focusContrastFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8"),
  readFile(path.join(repoRoot, "modern.css"), "utf8"),
  readFile(path.join(repoRoot, "styles.css"), "utf8"),
  readFile(path.join(repoRoot, "tokens.css"), "utf8")
]);
const focusContrastTestNames = [
  ...focusContrastSource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const focusContrastBodyMarker =
  "// OKLCH -> linear sRGB -> WCAG relative luminance, used to compute real";
const focusContrastBodyStart = focusContrastSource.indexOf(
  focusContrastBodyMarker
);
const focusContrastHeader = focusContrastSource.slice(
  0,
  focusContrastBodyStart
);
const focusContrastBodyBytes =
  Buffer.byteLength(focusContrastSource) - focusContrastBodyStart;
const focusContrastHelperNames = [
  "parseOklchTokens",
  "relativeLuminanceFromOklch",
  "oklchContrastRatio"
];
const adjacentMonolithTestNames = [
  "micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion",
  "color-scheme metadata matches the shipped dark-only theme"
];

assert.equal(
  focusContrastTestNames.length,
  3,
  "Mutation fixtures require the fixed three-test inventory"
);
assert.notEqual(
  focusContrastBodyStart,
  -1,
  "Mutation fixtures require the focus/contrast body boundary"
);
for (const helperName of focusContrastHelperNames) {
  assert.equal(
    [...focusContrastSource.matchAll(new RegExp(`\\bfunction\\s+${helperName}\\s*\\(`, "g"))]
      .length,
    1,
    `Mutation fixtures require one ${helperName} helper definition`
  );
}
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

async function writeRuntimeFixtures(rootDirectory, runtimeOverrides) {
  await Promise.all(
    runtimeFixturePaths.map((relativePath) => {
      const override = runtimeOverrides[relativePath];
      return override === undefined
        ? symlink(
            path.join(repoRoot, relativePath),
            path.join(rootDirectory, relativePath)
          )
        : writeFile(path.join(rootDirectory, relativePath), override);
    })
  );
}

async function runGuardMutation({
  focusContrast = focusContrastSource,
  extraQualityFiles = {},
  mutationGuard = mutationGuardSource,
  monolith = monolithFixtureSource,
  runtimeOverrides = {}
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-focus-contrast-guard-")
  );
  const fixtureQualityDirectory = path.join(fixtureRoot, "tests/quality");
  const fixtureHelperDirectory = path.join(fixtureRoot, "tests/helpers");

  try {
    await Promise.all([
      mkdir(fixtureQualityDirectory, { recursive: true }),
      mkdir(fixtureHelperDirectory, { recursive: true })
    ]);
    await writeRuntimeFixtures(fixtureRoot, runtimeOverrides);
    await Promise.all([
      writeFile(path.join(fixtureQualityDirectory, guardFile), guardSource),
      writeFile(
        path.join(fixtureQualityDirectory, mutationGuardFile),
        mutationGuard
      ),
      writeFile(
        path.join(fixtureQualityDirectory, focusContrastFile),
        focusContrast
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
        path.join(fixtureHelperDirectory, spawnHelperFile),
        spawnHelperSource
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
        timeout: qualitySpawnTimeoutMs
      }
    );
    assertQualitySpawnCompleted(
      result,
      "the focus/contrast structure guard fixture"
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
    `The actual structure guard accepted a prohibited mutation:\n${result.output}`
  );
  assert.match(result.output, expectedMessage);
}

mutationTest(
  "focus contrast structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "focus contrast structure guard rejects canonical names leaking into the monolith",
  async () => {
    const paddingStart = monolithFixtureSource.lastIndexOf("/*");
    assert.notEqual(paddingStart, -1, "Monolith fixture must retain its padding");
    const canonicalNameLeak = padWithComment(
      [
        monolithFixtureSource.slice(0, paddingStart),
        `const leakedCanonicalName = ${JSON.stringify(focusContrastTestNames[0])};`,
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
      /must exclusively own the three canonical focus\/contrast contracts/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects adjacent monolith contracts leaking into the focused module",
  async () => {
    const reviewedAssertionMessage = JSON.stringify(
      "on-dark override must keep excluding .language-toggle so it falls through to the default focus ring"
    );
    const adjacentContractLeak = replaceOncePreservingBytes(
      focusContrastSource,
      reviewedAssertionMessage,
      JSON.stringify(adjacentMonolithTestNames[1])
    );
    assert.equal(
      Buffer.byteLength(adjacentContractLeak),
      Buffer.byteLength(focusContrastSource)
    );
    await assertMutationRejected(
      { focusContrast: adjacentContractLeak },
      /adjacent parallax and color-scheme contracts must remain exclusively in the monolith/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects OKLCH helpers leaking into the monolith",
  async () => {
    const paddingStart = monolithFixtureSource.lastIndexOf("/*");
    assert.notEqual(paddingStart, -1, "Monolith fixture must retain its padding");
    const helperLeak = padWithComment(
      [
        monolithFixtureSource.slice(0, paddingStart),
        `function ${focusContrastHelperNames[0]}() {}`,
        ""
      ].join("\n"),
      Buffer.byteLength(monolithFixtureSource)
    );
    assert.equal(
      Buffer.byteLength(helperLeak),
      Buffer.byteLength(monolithFixtureSource)
    );
    await assertMutationRejected(
      { monolith: helperLeak },
      /OKLCH contrast helpers must remain exclusively in focus-contrast-contracts\.test\.mjs/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects computed duplicate registrations",
  async () => {
    const duplicateRegistration = appendSource(
      focusContrastSource,
      [
        `const duplicateFocusContrastName = ${JSON.stringify(focusContrastTestNames[0])};`,
        "test(duplicateFocusContrastName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { focusContrast: duplicateRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects dynamically assembled duplicate registrations",
  async () => {
    const splitMarker = " / backdrop ";
    const [namePrefix, nameSuffix] = focusContrastTestNames[1].split(splitMarker);
    assert.ok(nameSuffix, "Dynamic duplicate needs a stable split point");
    const dynamicDuplicate = appendSource(
      focusContrastSource,
      [
        `const dynamicFocusContrastName = ${JSON.stringify(`${namePrefix} / backdrop`)} + ${JSON.stringify(` ${nameSuffix}`)};`,
        "test(dynamicFocusContrastName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { focusContrast: dynamicDuplicate },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects hidden global duplicates",
  async () => {
    const hiddenName = focusContrastTestNames[2];
    const separator = " muted roles ";
    const separatorIndex = hiddenName.indexOf(separator);
    assert.notEqual(separatorIndex, -1, "Hidden duplicate needs a split point");
    const namePrefix = hiddenName.slice(0, separatorIndex);
    const nameSuffix = hiddenName.slice(separatorIndex + separator.length);
    const hiddenDuplicate = [
      'import { test as registerTest } from "node:test";',
      "",
      `const hiddenFocusContrastName = ${JSON.stringify(`${namePrefix} muted roles`)} + ${JSON.stringify(` ${nameSuffix}`)};`,
      "registerTest(hiddenFocusContrastName, () => {});",
      ""
    ].join("\n");
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "hidden-focus-contrast-duplicate.test.mjs": hiddenDuplicate
        }
      },
      /canonical focus\/contrast test names must be registered exactly once globally/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects skipped canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(focusContrastTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        focusContrast: replaceOnce(
          focusContrastSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.skip(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects todo canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(focusContrastTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        focusContrast: replaceOnce(
          focusContrastSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.todo(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects exclusive canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(focusContrastTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        focusContrast: replaceOnce(
          focusContrastSource,
          firstRegistration,
          firstRegistration.replace("test(", "test.only(")
        )
      },
      /must not register test\.only or an only option/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects runtime-disabled canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(focusContrastTestNames[0])}, async () => {`;
    const disabledRegistration =
      `test(${JSON.stringify(focusContrastTestNames[0])}, { skip: true }, async () => {`;
    await assertMutationRejected(
      {
        focusContrast: replaceOnce(
          focusContrastSource,
          firstRegistration,
          disabledRegistration
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "focus contrast structure guard binds the final focus selector assertion",
  async () => {
    const reviewedFocusRule = [
      ".contact-panel :where(a, button):focus-visible {",
      "  outline-color: var(--color-focus);",
      "}"
    ].join("\n");
    const brokenFocusRule = reviewedFocusRule.replace(
      "--color-focus",
      "--color-rule"
    );
    await assertMutationRejected(
      {
        runtimeOverrides: {
          "modern.css": replaceOnce(
            modernSource,
            reviewedFocusRule,
            brokenFocusRule
          )
        }
      },
      /modern\.css must override the contact focus ring with --color-focus/
    );
  }
);

mutationTest(
  "focus contrast structure guard binds the on-dark focus exclusion assertion",
  async () => {
    const reviewedOnDarkSelector =
      ".js-enabled .nav-menu :focus-visible:not(.language-toggle) {";
    const brokenOnDarkSelector =
      ".js-enabled .nav-menu :focus-visible {";
    await assertMutationRejected(
      {
        runtimeOverrides: {
          "styles.css": replaceOnce(
            stylesSource,
            reviewedOnDarkSelector,
            brokenOnDarkSelector
          )
        }
      },
      /on-dark override must keep excluding \.language-toggle/
    );
  }
);

mutationTest(
  "focus contrast structure guard binds the WCAG non-text contrast assertion",
  async () => {
    const weakenedTokens = replaceOnce(
      tokensSource,
      "    --color-focus: oklch(97% 0.03 90);",
      "    --color-focus: oklch(20% 0.03 253);"
    );
    await assertMutationRejected(
      { runtimeOverrides: { "tokens.css": weakenedTokens } },
      /must meet >= 3:1 non-text contrast/
    );
  }
);

mutationTest(
  "focus contrast structure guard binds the increased-contrast improvement assertion",
  async () => {
    const unchangedMutedRole = replaceOnce(
      tokensSource,
      "    --color-muted: oklch(86% 0.02 250);",
      "    --color-muted: oklch(72% 0.03 250);"
    );
    await assertMutationRejected(
      { runtimeOverrides: { "tokens.css": unchangedMutedRole } },
      /must improve by at least 0\.25/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects focused-module padding",
  async () => {
    await assertMutationRejected(
      { focusContrast: `${focusContrastSource} ` },
      /focus-contrast-contracts\.test\.mjs must be exactly 7888 bytes/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects monolith padding",
  async () => {
    await assertMutationRejected(
      { monolith: `${monolithFixtureSource} ` },
      /site-quality\.test\.mjs must be exactly 28655 bytes/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects a same-length inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      focusContrastBodyStart - 1
    )}\n`;
    const headerWrapperBypass =
      `${inertHeader}${focusContrastSource.slice(focusContrastBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(focusContrastSource)
    );
    assert.equal(
      headerWrapperBypass.slice(focusContrastBodyStart),
      focusContrastSource.slice(focusContrastBodyStart)
    );

    await assertMutationRejected(
      { focusContrast: headerWrapperBypass },
      /focus-contrast-contracts\.test\.mjs header SHA-256 must match the reviewed extraction/
    );
  }
);

mutationTest(
  "focus contrast structure guard rejects empty stubs plus unrelated extraction",
  async () => {
    const stubBody = [
      focusContrastBodyMarker,
      ...focusContrastHelperNames.map(
        (helperName) => `function ${helperName}() {}`
      ),
      "",
      ...focusContrastTestNames.map(
        (name) => `test(${JSON.stringify(name)}, () => {});`
      ),
      "",
      "const unrelatedThemeMetadataExtraction = true;",
      ""
    ].join("\n");
    const unrelatedExtraction =
      `${focusContrastHeader}${padWithComment(stubBody, focusContrastBodyBytes)}`;

    assert.equal(
      Buffer.byteLength(unrelatedExtraction),
      Buffer.byteLength(focusContrastSource)
    );

    await assertMutationRejected(
      { focusContrast: unrelatedExtraction },
      /assertion body SHA-256/
    );
  }
);

mutationTest(
  "focus contrast structure guard binds skipped mutation callbacks",
  async () => {
    const wrapperMarker = [
      "mutationTest(",
      '  "focus contrast structure guard accepts the reviewed unchanged extraction",',
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
          "\n    const hiddenCanonicalName = focusContrastTestNames[0].slice(0);" +
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
