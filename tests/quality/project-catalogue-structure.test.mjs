import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const monolithFile = "site-quality.test.mjs";
const catalogueFile = "project-catalogue.test.mjs";
const monolithMaximumBytes = 90_000;
const catalogueMaximumBytes = 55_000;
const expectedCatalogueTestNames = [
  "projects.json schema, localization, links, and preview assets are valid",
  "exactly six live projects expose verified public source actions",
  "exactly eight public projects expose reviewed immutable proof citations",
  "project runtime rejects incomplete, malformed, duplicate, and primary-equal source actions",
  "project action groups preserve primary-first safe localized links and responsive focus behavior",
  "project proof renders as a compact cited surface after primary actions",
  "mobile project AVIF pairs meet dimension and bandwidth budgets",
  "desktop project AVIF pairs meet exact format, dimensions, and bandwidth budgets",
  "project runtime validation requires distinct local JPEG and AVIF assets",
  "project rendering emits mutually exclusive AVIF sources before lazy JPEG fallbacks",
  "project catalogue status stays concise, atomic, and separate from rendered results"
];

function declaredTestNames(source) {
  return [...source.matchAll(/^test\("([^"]+)",/gm)].map((match) => match[1]);
}

test("site quality monolith stays below the project catalogue extraction boundary", async () => {
  const monolithStats = await stat(path.join(qualityDirectory, monolithFile));
  assert.ok(
    monolithStats.size <= monolithMaximumBytes,
    `${monolithFile} must be at most ${monolithMaximumBytes} bytes after the 43,806-byte catalogue extraction; received ${monolithStats.size}`
  );
});

test("project catalogue tests live in one focused bounded module", async () => {
  const entries = await readdir(qualityDirectory, { withFileTypes: true });
  const qualityTestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();

  assert.ok(
    qualityTestFiles.includes(catalogueFile),
    `${catalogueFile} must own the fixed project catalogue quality contracts`
  );

  const sourceEntries = await Promise.all(
    qualityTestFiles.map(async (file) => [
      file,
      await readFile(path.join(qualityDirectory, file), "utf8")
    ])
  );
  const sources = new Map(sourceEntries);
  const catalogueSource = sources.get(catalogueFile);
  const catalogueStats = await stat(path.join(qualityDirectory, catalogueFile));

  assert.ok(
    catalogueStats.size <= catalogueMaximumBytes,
    `${catalogueFile} must be at most ${catalogueMaximumBytes} bytes; received ${catalogueStats.size}`
  );
  assert.deepEqual(
    declaredTestNames(catalogueSource),
    expectedCatalogueTestNames,
    `${catalogueFile} must retain the exact bounded test-name inventory`
  );
  assert.doesNotMatch(
    catalogueSource,
    /\btest\.(?:only|skip|todo)\s*\(|^test\("[^"]+",\s*\{[\s\S]*?\b(?:only|skip|todo)\s*:/m,
    `${catalogueFile} must not disable or isolate catalogue coverage`
  );

  const allDeclaredNames = [...sources.values()].flatMap(declaredTestNames);
  for (const testName of expectedCatalogueTestNames) {
    assert.equal(
      allDeclaredNames.filter((name) => name === testName).length,
      1,
      `"${testName}" must be declared exactly once across tests/quality`
    );
  }
});
