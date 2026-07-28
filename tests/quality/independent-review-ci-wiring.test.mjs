import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const workflowsDirectory = path.join(repoRoot, ".github/workflows");
const guardPath = "scripts/check-independent-review.mjs";

function parseWorkflow(source, file) {
  const onBlock = source.match(/^on:\s*\n(?<body>(?:^[ \t]+.*(?:\n|$))*)/m);
  assert.ok(onBlock, `${file} must define a block-style on section`);

  const triggers = new Set(
    [...onBlock.groups.body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):/gm)].map(
      ([, trigger]) => trigger
    )
  );
  const lines = source.split(/\r?\n/);
  const runCommands = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = lines[index].match(/^(\s*)run:\s*(.*)$/);
    if (!runMatch) {
      continue;
    }

    const indent = runMatch[1].length;
    const scalar = runMatch[2].trim();
    if (scalar !== "|" && scalar !== ">") {
      runCommands.push(scalar);
      continue;
    }

    const block = [];
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1];
      const nextIndent = nextLine.match(/^\s*/)[0].length;
      if (nextLine.trim() !== "" && nextIndent <= indent) {
        break;
      }
      index += 1;
      block.push(nextLine.trim());
    }
    runCommands.push(block.join("\n"));
  }

  return { file, source, triggers, runCommands };
}

test("pull-request CI executes the independent-review guard instead of only syntax-checking it", async () => {
  const [packageSource, workflowEntries] = await Promise.all([
    readFile(path.join(repoRoot, "package.json"), "utf8"),
    readdir(workflowsDirectory, { withFileTypes: true })
  ]);
  const packageJson = JSON.parse(packageSource);
  const workflowFiles = workflowEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => entry.name)
    .sort();
  const workflows = await Promise.all(
    workflowFiles.map(async (file) =>
      parseWorkflow(await readFile(path.join(workflowsDirectory, file), "utf8"), file)
    )
  );

  assert.ok(workflows.length > 0, "at least one .github/workflows/*.yml file is required");

  const executableScripts = Object.entries(packageJson.scripts ?? {})
    .filter(([, command]) => {
      assert.equal(typeof command, "string", "every npm script must be a string");
      return (
        new RegExp(`^\\s*node\\s+${guardPath.replaceAll(".", "\\.")}(?:\\s|$)`).test(command) &&
        !/\bnode\s+--check\b/.test(command)
      );
    })
    .map(([name]) => name);

  assert.ok(
    executableScripts.length > 0,
    `package.json must define a dedicated npm script that executes ${guardPath} without node --check`
  );

  const pullRequestInvocations = workflows.flatMap((workflow) => {
    if (!workflow.triggers.has("pull_request")) {
      return [];
    }

    return workflow.runCommands
      .filter((command) =>
        executableScripts.some((script) =>
          new RegExp(`\\bnpm\\s+run\\s+${script.replaceAll(":", "\\:")}(?:\\s|$)`).test(command)
        )
      )
      .map((command) => ({ ...workflow, command }));
  });

  assert.ok(
    pullRequestInvocations.length > 0,
    `a pull_request workflow must invoke one of: ${executableScripts.join(", ")}`
  );
  assert.ok(
    pullRequestInvocations.some(({ source }) =>
      /if:\s*.*github\.event_name\s*==\s*'pull_request'.*github\.event\.pull_request\.state\s*==\s*'open'/.test(
        source
      )
    ),
    "the guard invocation must be limited to the current OPEN pull request"
  );
  for (const { command, file } of pullRequestInvocations) {
    assert.doesNotMatch(command, /\bnode\s+--check\b/, `${file} must execute the guard`);
  }
});
