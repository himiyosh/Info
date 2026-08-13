import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const removedPaths = [
  "REVIEW-PROCESS.md",
  "REVIEW-REQUEST.md",
  "scripts/check-independent-review.mjs",
  "tests/quality/independent-review-evidence.test.mjs"
];
const operationalRoots = [
  ".claude/knowledge",
  ".claude/rules",
  ".github/agents",
  ".github/workflows",
  "scripts"
];
const operationalFiles = [
  ".github/copilot-instructions.md",
  "CLAUDE.md",
  "README.md",
  "package.json"
];
const removedMechanismPatterns = [
  /independent[-_ ]review/i,
  /INDEPENDENT_REVIEW/,
  /verdict=(?:pass|fail)\s+by=/i,
  /RETRACTED-\S*review/i
];

async function collectFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childPath = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(childPath)));
    } else if (entry.isFile()) {
      files.push(childPath);
    }
  }

  return files;
}

test("dedicated review-evidence files remain deleted", async () => {
  for (const relativePath of removedPaths) {
    await assert.rejects(
      access(path.join(repoRoot, relativePath)),
      (error) => error?.code === "ENOENT",
      `${relativePath} must remain absent`
    );
  }
});

test("quality-baseline cannot restore the removed gate", async () => {
  const [packageSource, workflow] = await Promise.all([
    readFile(path.join(repoRoot, "package.json"), "utf8"),
    readFile(path.join(repoRoot, ".github/workflows/quality-baseline.yml"), "utf8")
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(
    packageJson.scripts["check:quality"],
    "npm run check:generated && npm run check:js && npm run test:quality"
  );
  assert.match(packageJson.scripts["check:js"], /node --check scripts\/check-merge-gate\.mjs/);
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    for (const pattern of removedMechanismPatterns) {
      assert.doesNotMatch(`${name}\n${command}`, pattern);
    }
  }

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /run: npm test/);
  assert.doesNotMatch(workflow, /^\s+(?:pull-requests|issues):/m);
  assert.doesNotMatch(workflow, /GH_TOKEN/);
  for (const pattern of removedMechanismPatterns) {
    assert.doesNotMatch(workflow, pattern);
  }
});

test("current operational surfaces do not advertise the removed mechanism", async () => {
  const nestedFiles = (
    await Promise.all(operationalRoots.map((relativePath) => collectFiles(relativePath)))
  ).flat();
  const paths = [...operationalFiles, ...nestedFiles];

  for (const relativePath of paths) {
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    for (const pattern of removedMechanismPatterns) {
      assert.doesNotMatch(source, pattern, `${relativePath} still references the removed mechanism`);
    }
  }
});

test("the retained merge gate uses objective pull-request fields only", async () => {
  const [mergeGate, readme, agent, handoff] = await Promise.all([
    readFile(path.join(repoRoot, "scripts/check-merge-gate.mjs"), "utf8"),
    readFile(path.join(repoRoot, "README.md"), "utf8"),
    readFile(path.join(repoRoot, ".github/agents/InfoAgent.agent.md"), "utf8"),
    readFile(path.join(repoRoot, "HANDOFF.md"), "utf8")
  ]);

  for (const source of [mergeGate, readme, agent]) {
    assert.match(source, /state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup/);
  }
  assert.doesNotMatch(mergeGate, /\breviews?\b|\bcomments?\b/i);
  assert.match(readme, /Optional code and security reviews remain available/);
  assert.match(agent, /ordinary code review or security review/);
  assert.match(handoff, /現在の運用手順ではない/);
  assert.match(handoff, /完全廃止/);
});
