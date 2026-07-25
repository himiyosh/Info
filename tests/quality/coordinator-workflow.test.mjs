import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const agentPath = ".github/agents/InfoAgent.agent.md";

test("InfoAgent preserves the coordinator session topology and cleanup contract", async () => {
  const source = await readFile(path.join(repoRoot, agentPath), "utf8");

  assert.match(
    source,
    /Start every human-readable session name[\s\S]*?`ℹ️`/,
    "Session names must retain the project icon"
  );
  assert.match(
    source,
    /`ℹ️ YYYY-MM-DD 統括`/,
    "The canonical coordinator name must include the date and coordinator role"
  );
  assert.match(
    source,
    /compact control plane, not an implementation log/,
    "The coordinator must remain a compact control plane"
  );
  assert.match(source, /alone has merge authority/, "The coordinator must retain merge authority");
  assert.match(
    source,
    /fresh task sessions: one bounded task, branch, and reviewable PR per session/,
    "Implementation must stay in bounded fresh task sessions"
  );
  assert.match(source, /no more than three active child tasks/, "Active child work must stay bounded");
  assert.match(
    source,
    /outcome, branch\/SHA\/PR, changed files, validation, blockers, and cleanup readiness/,
    "Child reports must include the compact handoff fields"
  );
  assert.match(
    source,
    /meaningful milestones, record a compact recovery manifest\/checkpoint/,
    "Meaningful milestones must leave a compact recovery checkpoint"
  );
  assert.match(
    source,
    /After production verification, archive completed children and remove their merged branches/,
    "Completed child sessions and merged branches must be cleaned up after production verification"
  );
  assert.match(
    source,
    /Implementation child sessions never merge pull requests\. The coordinator reviews and merges only after required checks and production gates\./,
    "Implementation children must not receive delegated merge authority"
  );
  assert.doesNotMatch(
    source,
    /do not merge unless the coordinator explicitly authorizes it/,
    "The policy must not permit delegated child merges"
  );
});
