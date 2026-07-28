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
    /Reuse `ℹ️` for every human-readable session name in this project/,
    "Session names must retain the project icon"
  );
  assert.match(
    source,
    /The canonical coordinator name is `ℹ️ YYYY-MM-DD Info 統括 gN`/,
    "The canonical coordinator name must include the date, project, role, and generation"
  );
  assert.match(
    source,
    /each task child is named `ℹ️ YYYY-MM-DD Info <task>`/,
    "Task child names must retain the same project identity and icon"
  );
  assert.doesNotMatch(
    source,
    /`ℹ️ YYYY-MM-DD 統括`/,
    "The generation-ambiguous legacy coordinator name must not return"
  );
  assert.match(
    source,
    /Keep one logical coordinator generation active at a time/,
    "Only one logical coordinator generation may be active"
  );
  assert.match(
    source,
    /compact control plane, not an implementation log/,
    "The coordinator must remain a compact control plane"
  );
  assert.match(source, /alone has merge authority/, "The coordinator must retain merge authority");
  assert.match(
    source,
    /task sessions attached as children of the current coordinator generation/,
    "Task sessions must remain attached to their owning coordinator"
  );
  assert.match(
    source,
    /one bounded task, branch, and reviewable PR per child/,
    "Implementation must stay in bounded task sessions"
  );
  assert.match(source, /no more than three active children/, "Active child work must stay bounded");
  assert.match(
    source,
    /Before creating a child, perform a bounded active-session lookup and reuse a compatible active child owned by the current coordinator/,
    "Compatible active owned children must be reused before creating sessions"
  );
  assert.match(
    source,
    /Never wake historical idle or unowned sessions merely to inspect or reuse them/,
    "Historical idle and unowned sessions must remain untouched"
  );
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
  for (const skill of [
    "autonomous-project-improvement",
    "safe-session-suspend",
    "safe-session-resume",
  ]) {
    assert.match(source, new RegExp(`\`${skill}\``), `InfoAgent must refer to the ${skill} skill`);
  }
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
  assert.match(
    source,
    /Never use `reviews\.length == 0` as evidence that independent review is absent/,
    "An empty reviews array must not erase comment-based review evidence"
  );
  assert.match(
    source,
    /Always query both `reviews` and `comments`/,
    "The merge gate must query review and comment bodies"
  );
  assert.match(
    source,
    /Require a contiguous standalone marker/,
    "The merge gate must require a contiguous exact full-head verdict marker"
  );
  assert.match(
    source,
    /`independent-review head=<40-character current head SHA> verdict=pass` is the only clearance form/,
    "Only the contiguous pass marker may provide clearance"
  );
  assert.match(
    source,
    /detached verdict prose/,
    "Detached verdict syntax must not complete a legacy marker"
  );
  assert.match(
    source,
    /Each active marker must express exactly one verdict\. After the first verdict, a second standalone `pass` or `fail` introduced by whitespace, English `or`, or one of the symbolic separators `\|`, `\/`, `,`, `、`, `;`, and `；` invalidates that marker/,
    "A second verdict after any documented separator must not satisfy the review gate"
  );
  assert.match(
    source,
    /A delimiter remains valid when it begins non-verdict explanatory prose, including a Markdown table cell, rather than a second verdict/,
    "Ordinary punctuation must remain compatible with explanatory prose and Markdown tables"
  );
  assert.match(source, /Any fail wins over any pass regardless of order or surface/, "Fail evidence must dominate pass evidence");
  assert.match(
    source,
    /edit the original comment marker to `RETRACTED-independent-review head=<40-character reviewed head SHA> verdict=<pass\|fail>`/,
    "Incorrect verdicts must be retracted in their original comment"
  );
  assert.match(
    source,
    /retain a retraction reason in that comment/,
    "Verdict retractions must preserve their reason"
  );
  assert.match(
    source,
    /Do not merely add an opposite verdict: an active fail marker still wins/,
    "An opposite verdict must not masquerade as retraction"
  );
  assert.match(
    source,
    /Pin the pull request's full head SHA at review start/,
    "Independent review must pin its starting head"
  );
  assert.match(
    source,
    /Immediately before posting a verdict, re-fetch `headRefOid` and require exact equality with the pinned head/,
    "Review posting must close the head-change race"
  );
  assert.match(
    source,
    /If it changed, do not post the stale verdict; inspect the compare delta and review the new head/,
    "A changed head must be compared and reviewed before posting"
  );
  assert.match(
    source,
    /generated-only delta, and only after the compare proves that scope and the relevant implementation blob SHAs are identical/,
    "Generated-only reuse requires compare and implementation blob equality proof"
  );
  assert.match(
    source,
    /pass-only evidence satisfies the review verdict, no valid verdict exits 1, malformed input exits 2, and any fail exits 3/,
    "The review verifier exit contract must remain explicit"
  );
  assert.match(
    source,
    /state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments \| node scripts\/check-merge-gate\.mjs --head/,
    "The merge gate must validate the complete machine-readable PR snapshot"
  );
  assert.match(
    source,
    /treat every nonzero exit as a blocked merge/,
    "Verifier errors and missing evidence must block merge"
  );
  assert.match(
    source,
    /it does not inspect the review's reasoning or scope/,
    "The machine gate must not represent a pass marker as complete review analysis"
  );
  for (const limitation of [
    "production deployment",
    "secrets",
    "permissions",
    "billing",
    "public-scope suitability",
    "documentation completeness",
    "unresolved review findings",
  ]) {
    assert.match(source, new RegExp(limitation), `The coordinator must still evaluate ${limitation}`);
  }
  assert.match(
    source,
    /Re-fetch the full pull-request snapshot and rerun the gate immediately before merge/,
    "Merge decisions must use a freshly fetched snapshot"
  );
  assert.match(
    source,
    /Never merge from cached JSON or an earlier successful invocation/,
    "Cached merge-gate evidence must not authorize merge"
  );
  assert.match(
    source,
    /archive only terminal children owned by the current coordinator after their compact reports are durably recorded/,
    "Only owned terminal children with durable reports may be archived"
  );
  assert.match(
    source,
    /Delete a task branch only after its pull request is merged and its tip is verified reachable from `main`/,
    "Task branch deletion requires a merged PR and default-branch reachability"
  );
  assert.match(
    source,
    /not the default branch, is not protected, and has no open pull request, active worktree, or dependent stack relying on it/,
    "Task branch deletion must protect default, protected, open-PR, worktree, and stacked work"
  );
  assert.match(
    source,
    /Never delete unmerged work, force-push, rewrite history, or use destructive reset or clean operations/,
    "Destructive cleanup and history rewriting must remain forbidden"
  );

  for (const unsafePermission of [
    /(?:may|can|allowed to) delete unmerged work/i,
    /(?:may|can|allowed to) force-push/i,
    /(?:may|can|allowed to) rewrite history/i,
    /(?:may|can|allowed to) use destructive (?:reset|clean)/i,
  ]) {
    assert.doesNotMatch(source, unsafePermission, "Unsafe permissive cleanup wording must be rejected");
  }
});
