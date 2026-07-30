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
const guardFile = "public-discovery-contracts-structure.test.mjs";
const mutationGuardFile =
  "public-discovery-contracts-structure-mutations.test.mjs";
const publicDiscoveryFile = "public-discovery-contracts.test.mjs";
const monolithFile = "site-quality.test.mjs";
const globalInventoryEnvironments = [
  "INFO_WORKFLOW_SECURITY_INVENTORY",
  "INFO_LOCALIZATION_INVENTORY",
  "INFO_PROJECT_CATALOGUE_INVENTORY",
  "INFO_PUBLISHING_INTEGRITY_INVENTORY",
  "INFO_MOBILE_NAVIGATION_INVENTORY",
  "INFO_ASSET_INTEGRITY_INVENTORY",
  "INFO_PUBLIC_DISCOVERY_INVENTORY"
];
const globalInventoryEnvironmentValue = "complete-runtime-v1";
const globalInventoryChildMode = globalInventoryEnvironments.some(
  (environmentName) =>
    process.env[environmentName] === globalInventoryEnvironmentValue
);
const mutationTest = globalInventoryChildMode ? test.skip : test;
const childProcessEnv = { ...process.env, NO_COLOR: "1" };
delete childProcessEnv.NODE_TEST_CONTEXT;
const runtimeFixturePaths = ["index.html", "projects.json"];
const [
  boundaryAuthoritySource,
  guardSource,
  mutationGuardSource,
  publicDiscoverySource,
  monolithSource
] = await Promise.all([
  readFile(path.join(helperDirectory, boundaryAuthorityFile), "utf8"),
  readFile(path.join(qualityDirectory, guardFile), "utf8"),
  readFile(path.join(qualityDirectory, mutationGuardFile), "utf8"),
  readFile(path.join(qualityDirectory, publicDiscoveryFile), "utf8"),
  readFile(path.join(qualityDirectory, monolithFile), "utf8")
]);
const publicDiscoveryTestNames = [
  ...publicDiscoverySource.matchAll(/^test\("([^"]+)",/gm)
].map((match) => match[1]);
const publicDiscoveryBodyStart = publicDiscoverySource.indexOf(
  `test(${JSON.stringify(publicDiscoveryTestNames[0])}`
);
const publicDiscoveryHeader = publicDiscoverySource.slice(
  0,
  publicDiscoveryBodyStart
);
const publicDiscoveryBodyBytes =
  Buffer.byteLength(publicDiscoverySource) - publicDiscoveryBodyStart;
const adjacentMonolithTestNames = [
  "JavaScript files are parseable",
  "rejected continuous curiosity field recovery remains absent",
  "new-tab links include bilingual accessibility announcement text"
];

assert.equal(
  publicDiscoveryTestNames.length,
  3,
  "Mutation fixtures require the fixed three-test inventory"
);
assert.notEqual(
  publicDiscoveryBodyStart,
  -1,
  "Mutation fixtures require the public discovery body boundary"
);
const monolithFixtureSource = padWithComment(
  [
    'import { test } from "node:test";',
    "",
    ...adjacentMonolithTestNames.map(
      (name) => `test(${JSON.stringify(name)}, () => {});`
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
  const remainingBytes = Buffer.byteLength(marker) - Buffer.byteLength(replacement);
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
  extraQualityFiles = {},
  guard = guardSource,
  monolith = monolithFixtureSource,
  mutationGuard = mutationGuardSource,
  publicDiscovery = publicDiscoverySource
} = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "info-public-discovery-guard-")
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
        path.join(fixtureQualityDirectory, publicDiscoveryFile),
        publicDiscovery
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
  "public discovery structure guard accepts the reviewed unchanged extraction",
  async () => {
    const result = await runGuardMutation();
    assert.equal(result.status, 0, result.output);
  }
);

mutationTest(
  "public discovery structure guard rejects canonical names leaking into the monolith",
  async () => {
    const paddingStart = monolithFixtureSource.lastIndexOf("/*");
    assert.notEqual(paddingStart, -1, "Monolith fixture must retain its padding");
    const canonicalNameLeak = padWithComment(
      [
        monolithFixtureSource.slice(0, paddingStart),
        `const leakedCanonicalName = ${JSON.stringify(publicDiscoveryTestNames[0])};`,
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
      /must exclusively own the three canonical public discovery contracts/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects adjacent monolith contracts leaking into the focused module",
  async () => {
    const reviewedAssertionMessage = JSON.stringify(
      "Static summary primary actions must exactly match the canonical project destinations"
    );
    const adjacentContractLeak = replaceOncePreservingBytes(
      publicDiscoverySource,
      reviewedAssertionMessage,
      JSON.stringify(adjacentMonolithTestNames[0])
    );
    assert.equal(
      Buffer.byteLength(adjacentContractLeak),
      Buffer.byteLength(publicDiscoverySource)
    );
    await assertMutationRejected(
      { publicDiscovery: adjacentContractLeak },
      /adjacent JavaScript, rejected-experiment, and new-tab contracts must remain exclusively in the monolith/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects computed duplicate registrations",
  async () => {
    const duplicateRegistration = appendSource(
      publicDiscoverySource,
      [
        `const duplicatePublicDiscoveryName = ${JSON.stringify(publicDiscoveryTestNames[0])};`,
        "test(duplicatePublicDiscoveryName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { publicDiscovery: duplicateRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects dynamic test registrations",
  async () => {
    const dynamicRegistration = appendSource(
      publicDiscoverySource,
      [
        'const dynamicPublicDiscoveryName = ["dynamic", "public", "discovery", "contract"].join(" ");',
        "test(dynamicPublicDiscoveryName, () => {});"
      ].join("\n")
    );
    await assertMutationRejected(
      { publicDiscovery: dynamicRegistration },
      /exact runtime test-name inventory/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects hidden global duplicates",
  async () => {
    const [namePrefix, nameSuffix] = publicDiscoveryTestNames[0].split(
      " social metadata"
    );
    const hiddenDuplicate = [
      'import { test as registerTest } from "node:test";',
      "",
      `const canonicalName = ${JSON.stringify(`${namePrefix} `)} + ${JSON.stringify(`social metadata${nameSuffix}`)};`,
      "registerTest(canonicalName, () => {});",
      ""
    ].join("\n");
    await assertMutationRejected(
      {
        extraQualityFiles: {
          "hidden-public-discovery-duplicate.test.mjs": hiddenDuplicate
        }
      },
      /canonical public discovery test names must be registered exactly once globally/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects runtime-disabled canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(publicDiscoveryTestNames[0])}, async () => {`;
    const runtimeDisabled = replaceOnce(
      publicDiscoverySource,
      firstRegistration,
      `${firstRegistration.slice(0, -"() => {".length)}(context) => {\n  context.skip("mutation");\n  return;`
    );
    await assertMutationRejected(
      { publicDiscovery: runtimeDisabled },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects skipped canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(publicDiscoveryTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        publicDiscovery: replaceOnce(
          publicDiscoverySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.skip(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects todo canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(publicDiscoveryTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        publicDiscovery: replaceOnce(
          publicDiscoverySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.todo(")
        )
      },
      /must execute all three contracts without skip or todo/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects exclusive canonical contracts",
  async () => {
    const firstRegistration =
      `test(${JSON.stringify(publicDiscoveryTestNames[0])}, async () => {`;
    await assertMutationRejected(
      {
        publicDiscovery: replaceOnce(
          publicDiscoverySource,
          firstRegistration,
          firstRegistration.replace("test(", "test.only(")
        )
      },
      /must not register test\.only or an only option/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects focused-module padding",
  async () => {
    await assertMutationRejected(
      { publicDiscovery: `${publicDiscoverySource} ` },
      /public-discovery-contracts\.test\.mjs must be exactly 4993 bytes/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects monolith padding",
  async () => {
    await assertMutationRejected(
      { monolith: `${monolithFixtureSource} ` },
      /site-quality\.test\.mjs must be exactly 31213 bytes/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects a same-length inert header wrapper",
  async () => {
    const inertHeader = `${padWithComment(
      'import { test as t } from "node:test"; const test=(name)=>t(name,()=>{});\n',
      publicDiscoveryBodyStart - 1
    )}\n`;
    const headerWrapperBypass =
      `${inertHeader}${publicDiscoverySource.slice(publicDiscoveryBodyStart)}`;

    assert.equal(
      Buffer.byteLength(headerWrapperBypass),
      Buffer.byteLength(publicDiscoverySource)
    );
    assert.equal(
      headerWrapperBypass.slice(publicDiscoveryBodyStart),
      publicDiscoverySource.slice(publicDiscoveryBodyStart)
    );

    await assertMutationRejected(
      { publicDiscovery: headerWrapperBypass },
      /public-discovery-contracts\.test\.mjs header SHA-256 must match the reviewed extraction/
    );
  }
);

mutationTest(
  "public discovery structure guard rejects empty stubs plus unrelated extraction",
  async () => {
    const stubBody = [
      ...publicDiscoveryTestNames.map(
        (name) => `test(${JSON.stringify(name)}, () => {});`
      ),
      "",
      "const unrelatedNewTabAccessibilityExtraction = true;",
      ""
    ].join("\n");
    const unrelatedExtraction =
      `${publicDiscoveryHeader}${padWithComment(stubBody, publicDiscoveryBodyBytes)}`;

    assert.equal(
      Buffer.byteLength(unrelatedExtraction),
      Buffer.byteLength(publicDiscoverySource)
    );

    await assertMutationRejected(
      { publicDiscovery: unrelatedExtraction },
      /assertion body SHA-256/
    );
  }
);

mutationTest(
  "public discovery structure guard binds skipped mutation callbacks",
  async () => {
    const wrapperMarker = [
      "mutationTest(",
      '  "public discovery structure guard accepts the reviewed unchanged extraction",',
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
          "\n    const hiddenCanonicalName = publicDiscoveryTestNames[0].slice(0);" +
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
