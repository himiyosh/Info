import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const qualityDirectory = path.join(repoRoot, "tests/quality");
const helperDirectory = path.join(repoRoot, "tests/helpers");
const authorityFile = "site-quality-boundary.mjs";
const authorityPath = path.join("tests/helpers", authorityFile);
const contractPath = "tests/quality/site-quality-boundary.test.mjs";
const monolithPath = path.join(qualityDirectory, "site-quality.test.mjs");
const focusedGuardFiles = [
  "asset-integrity-contracts-structure.test.mjs",
  "baseline-motion-safety-structure.test.mjs",
  "focus-contrast-contracts-structure.test.mjs",
  "localization-contracts-structure.test.mjs",
  "mobile-navigation-contracts-structure.test.mjs",
  "project-catalogue-structure.test.mjs",
  "public-discovery-contracts-structure.test.mjs",
  "publishing-integrity-structure.test.mjs",
  "reduced-motion-contracts-structure.test.mjs",
  "workflow-security-structure.test.mjs"
];
const isolatedMutationFixtureFiles = [
  "asset-integrity-contracts-structure-mutations.test.mjs",
  "baseline-motion-safety-structure-mutations.test.mjs",
  "focus-contrast-contracts-structure-mutations.test.mjs",
  "mobile-navigation-contracts-structure-mutations.test.mjs",
  "project-catalogue-structure-mutations.test.mjs",
  "public-discovery-contracts-structure-mutations.test.mjs",
  "reduced-motion-contracts-structure-mutations.test.mjs"
];
const authorityImportPattern =
  /^import { siteQualityExpectedBytes } from "\.\.\/helpers\/site-quality-boundary\.mjs";$/gm;
const legacyDeclarationPattern = /\bconst\s+monolithExpectedBytes\s*=/g;
const authorityDeclarationPattern =
  /\bexport\s+const\s+siteQualityExpectedBytes\s*=/g;
const authoritySourcePattern =
  /^export const siteQualityExpectedBytes = [1-9][\d_]*;\n$/;
const authorityReadPattern =
  /readFile\(path\.join\(helperDirectory, boundaryAuthorityFile\), "utf8"\)/;
const fixtureAuthorityWritePattern =
  /writeFile\(\s*path\.join\(fixtureHelperDirectory, boundaryAuthorityFile\),\s*boundaryAuthoritySource\s*\)/;
const boundaryAssertionPattern =
  /assert\.equal\(\s*monolithStats\.size,\s*siteQualityExpectedBytes,\s*`\$\{monolithFile\} must be exactly \$\{siteQualityExpectedBytes\} bytes at the reviewed/;

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

async function readModuleSources(directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
      .map(async (entry) => {
        const relativePath = path.join(relativeDirectory, entry.name);
        return [relativePath, await readFile(path.join(directory, entry.name), "utf8")];
      })
  );
}

test(
  "focused structure guards share one reviewed site-quality byte boundary authority",
  async () => {
    const sourceEntries = (
      await Promise.all([
        readModuleSources(qualityDirectory, "tests/quality"),
        readModuleSources(helperDirectory, "tests/helpers")
      ])
    ).flat();
    const sourceByPath = new Map(sourceEntries);
    const legacyDeclarations = sourceEntries.flatMap(([relativePath, source]) =>
      Array.from(
        { length: countMatches(source, legacyDeclarationPattern) },
        () => relativePath
      )
    );
    const authorityDeclarations = sourceEntries
      .filter(([relativePath]) => relativePath !== contractPath)
      .flatMap(([relativePath, source]) =>
        Array.from(
          { length: countMatches(source, authorityDeclarationPattern) },
          () => relativePath
        )
      );
    const problems = [];

    if (legacyDeclarations.length > 0) {
      problems.push(
        `Remove ${legacyDeclarations.length} per-file monolithExpectedBytes declaration(s): ${legacyDeclarations.join(", ")}`
      );
    }
    if (
      authorityDeclarations.length !== 1 ||
      authorityDeclarations[0] !== authorityPath
    ) {
      problems.push(
        `Expected exactly one reviewed site-quality byte boundary authority at ${authorityPath}; found ${authorityDeclarations.length}: ${authorityDeclarations.join(", ") || "none"}`
      );
    }

    for (const guardFile of focusedGuardFiles) {
      const guardPath = path.join("tests/quality", guardFile);
      const guardSource = sourceByPath.get(guardPath);
      assert.ok(guardSource, `Missing focused structure guard: ${guardPath}`);
      if (countMatches(guardSource, authorityImportPattern) !== 1) {
        problems.push(
          `${guardPath} must import siteQualityExpectedBytes exactly once from ${authorityPath}`
        );
      }
      if (!boundaryAssertionPattern.test(guardSource)) {
        problems.push(
          `${guardPath} must compare the monolith byte size with siteQualityExpectedBytes`
        );
      }
    }

    for (const fixtureFile of isolatedMutationFixtureFiles) {
      const fixturePath = path.join("tests/quality", fixtureFile);
      const fixtureSource = sourceByPath.get(fixturePath);
      assert.ok(
        fixtureSource,
        `Missing isolated mutation fixture writer: ${fixturePath}`
      );
      if (
        !fixtureSource.includes(
          `const boundaryAuthorityFile = "${authorityFile}";`
        ) ||
        !authorityReadPattern.test(fixtureSource) ||
        !fixtureAuthorityWritePattern.test(fixtureSource)
      ) {
        problems.push(
          `${fixturePath} must copy ${authorityPath} into its isolated fixture root`
        );
      }
    }

    const authoritySource = sourceByPath.get(authorityPath);
    if (authoritySource !== undefined) {
      if (!authoritySourcePattern.test(authoritySource)) {
        problems.push(
          `${authorityPath} must remain a dependency-free single-export byte authority`
        );
      } else {
        const authorityModule = await import(
          pathToFileURL(path.join(repoRoot, authorityPath))
        );
        const monolithStats = await stat(monolithPath);
        assert.deepEqual(
          Object.keys(authorityModule),
          ["siteQualityExpectedBytes"],
          `${authorityPath} must expose only siteQualityExpectedBytes`
        );
        assert.ok(
          Number.isSafeInteger(authorityModule.siteQualityExpectedBytes) &&
            authorityModule.siteQualityExpectedBytes > 0,
          `${authorityPath} must export a positive safe-integer byte boundary`
        );
        assert.equal(
          monolithStats.size,
          authorityModule.siteQualityExpectedBytes,
          `${authorityPath} must match the current reviewed site-quality.test.mjs byte boundary`
        );
      }
    }

    assert.deepEqual(
      problems,
      [],
      `Centralize the reviewed site-quality byte boundary:\n- ${problems.join("\n- ")}`
    );
  }
);
