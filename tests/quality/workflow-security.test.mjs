import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityWorkflowPath = ".github/workflows/quality-baseline.yml";
const externalLinkWorkflowPath = ".github/workflows/external-link-health.yml";
const pagesWorkflowPath = ".github/workflows/pages.yml";

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("workflow actions are pinned to immutable Node.js-24-compatible SHAs", async () => {
  const qualityWorkflow = await readUtf8(qualityWorkflowPath);
  const externalLinkWorkflow = await readUtf8(externalLinkWorkflowPath);
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const expectedPins = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/upload-pages-artifact", "fc324d3547104276b827a68afc52ff2a11cc49c9"],
    ["actions/configure-pages", "45bfe0192ca1faeb007ade9deae92b16b8254a0d"],
    ["actions/deploy-pages", "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"]
  ]);

  const usesPattern = /^\s*uses:\s*([a-z0-9-]+\/[a-z0-9-]+)@([a-f0-9]{40})\s*$/gim;
  const usesByAction = new Map();
  for (const workflow of [qualityWorkflow, externalLinkWorkflow, pagesWorkflow]) {
    for (const match of workflow.matchAll(usesPattern)) {
      usesByAction.set(match[1], match[2]);
    }
  }

  for (const [actionName, expectedSha] of expectedPins) {
    assert.equal(
      usesByAction.get(actionName),
      expectedSha,
      `Expected immutable pin for ${actionName} to be ${expectedSha}`
    );
  }

  assert.doesNotMatch(
    `${qualityWorkflow}\n${externalLinkWorkflow}\n${pagesWorkflow}`,
    /actions\/(?:checkout|setup-node|upload-pages-artifact|configure-pages|deploy-pages)@v\d+/i,
    "Pinned actions must not use mutable version tags"
  );
});

test("workflow checkouts do not persist credentials", async () => {
  for (const [workflowName, workflowPath] of [
    ["Quality", qualityWorkflowPath],
    ["External link health", externalLinkWorkflowPath],
    ["Pages", pagesWorkflowPath]
  ]) {
    const workflow = await readUtf8(workflowPath);
    assert.match(
      workflow,
      /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s*\n\s*with:\s*\n\s+persist-credentials:\s*false/,
      `${workflowName} checkout must set persist-credentials: false`
    );
  }
});

test("Pages workflow keeps least-privilege permissions and artifact-only deployment", async () => {
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const buildBlock = pagesWorkflow.match(/\n  build:\n([\s\S]*?)\n  deploy:\n/);
  const deployBlock = pagesWorkflow.match(/\n  deploy:\n([\s\S]*)$/);

  assert.match(
    pagesWorkflow,
    /permissions:\n\s+contents:\s+read/,
    "Workflow-level permissions must default to contents: read"
  );
  assert.ok(buildBlock, "Pages workflow must define a build job");
  assert.ok(deployBlock, "Pages workflow must define a deploy job");

  assert.match(buildBlock[1], /permissions:\n\s+contents:\s+read/, "Build job must request contents:read");
  assert.doesNotMatch(buildBlock[1], /pages:\s+write/, "Build job must not request pages:write");
  assert.doesNotMatch(buildBlock[1], /id-token:\s+write/, "Build job must not request id-token:write");
  assert.match(buildBlock[1], /timeout-minutes:\s*5/, "Build job must set a short timeout");

  assert.match(deployBlock[1], /permissions:\n\s+pages:\s+write\n\s+id-token:\s+write/, "Deploy job must request pages:write and id-token:write");
  assert.doesNotMatch(deployBlock[1], /contents:\s+write/, "Deploy job must not request contents:write");
  assert.match(deployBlock[1], /timeout-minutes:\s*5/, "Deploy job must set a short timeout");
  assert.match(
    deployBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d[\s\S]*uses:\s*actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128/,
    "Configure Pages must run in deploy immediately before deploy-pages"
  );
  assert.doesNotMatch(
    buildBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d/,
    "Build job must not run configure-pages"
  );
  assert.match(
    buildBlock[1],
    /uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    "Build job must pin Node before checking generated pages"
  );
  assert.match(
    buildBlock[1],
    /name:\s*Verify generated static pages[\s\S]*run:\s*npm run check:generated/,
    "Build job must reject generated-page drift before artifact assembly"
  );

  assert.match(
    pagesWorkflow,
    /done < \.github\/pages-artifact-whitelist\.txt/,
    "Build step must source deployment paths from the whitelist file"
  );
  assert.match(
    pagesWorkflow,
    /uses:\s*actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9[\s\S]*?path:\s*_site/,
    "Pages artifact upload must publish only the _site directory"
  );
});
