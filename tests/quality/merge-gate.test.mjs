import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  evaluateMergeGate,
  parseMergeGateArguments,
  parseMergeGateJson,
  validateHeadSha
} from "../../scripts/check-merge-gate.mjs";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/check-merge-gate.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";

function checkRun(name = "quality", overrides = {}) {
  return {
    __typename: "CheckRun",
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    ...overrides
  };
}

function mergeGateInput(overrides = {}) {
  return {
    state: "OPEN",
    isDraft: false,
    headRefOid: HEAD,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [checkRun()],
    ...overrides
  };
}

function runCli(input, args = ["--head", HEAD]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input)
  });
}

test("multiple successful checks satisfy the objective gate", () => {
  const input = mergeGateInput({
    statusCheckRollup: [checkRun("quality"), checkRun("security")]
  });
  const evaluated = evaluateMergeGate(input, HEAD);

  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.pullRequest.checks.length, 2);
  assert.deepEqual(evaluated.failures, []);

  const result = runCli(input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`head=${HEAD}`));
  assert.match(result.stdout, /state=OPEN isDraft=false mergeable=MERGEABLE/);
  assert.match(result.stdout, /mergeStateStatus=CLEAN checks=2\/2/);
});

test("closed and draft pull requests are blocked", () => {
  const closed = runCli(mergeGateInput({ state: "CLOSED" }));
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /state="CLOSED"; expected "OPEN"/);

  const draft = runCli(mergeGateInput({ isDraft: true }));
  assert.equal(draft.status, 1);
  assert.match(draft.stderr, /isDraft=true; expected false/);
});

test("conflicting, DIRTY, and BLOCKED merge states are blocked", () => {
  const dirty = runCli(
    mergeGateInput({
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY"
    })
  );
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /mergeable="CONFLICTING"; expected "MERGEABLE"/);
  assert.match(dirty.stderr, /mergeStateStatus="DIRTY"; expected "CLEAN"/);

  const blocked = runCli(mergeGateInput({ mergeStateStatus: "BLOCKED" }));
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /mergeStateStatus="BLOCKED"; expected "CLEAN"/);
});

test("a valid but different head is blocked", () => {
  const result = runCli(mergeGateInput({ headRefOid: OTHER_HEAD }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`headRefOid="${OTHER_HEAD}"`));
  assert.match(result.stderr, new RegExp(`expected exact --head "${HEAD}"`));
});

test("an empty check rollup is blocked", () => {
  const result = runCli(mergeGateInput({ statusCheckRollup: [] }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reports no checks; at least one successful check is required/);
});

test("pending and failing checks are each reported and block the gate", () => {
  const result = runCli(
    mergeGateInput({
      statusCheckRollup: [
        checkRun("pending", { status: "IN_PROGRESS", conclusion: null }),
        checkRun("failing", { conclusion: "FAILURE" })
      ]
    })
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /"pending" has status="IN_PROGRESS" conclusion=null; expected status="COMPLETED" conclusion="SUCCESS"/
  );
  assert.match(
    result.stderr,
    /"failing" has status="COMPLETED" conclusion="FAILURE"; expected status="COMPLETED" conclusion="SUCCESS"/
  );
});

test("legacy status contexts are handled explicitly", () => {
  const successful = runCli(
    mergeGateInput({
      statusCheckRollup: [
        {
          __typename: "StatusContext",
          context: "legacy-ci",
          state: "SUCCESS"
        }
      ]
    })
  );
  assert.equal(successful.status, 0, successful.stderr);

  const failing = runCli(
    mergeGateInput({
      statusCheckRollup: [
        {
          __typename: "StatusContext",
          context: "legacy-ci",
          state: "PENDING"
        }
      ]
    })
  );
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /"legacy-ci" has state="PENDING"; expected state="SUCCESS"/);
});

test("malformed CLI arguments, heads, and JSON fail with validation errors", () => {
  assert.equal(validateHeadSha(HEAD), HEAD);
  assert.throws(() => validateHeadSha(HEAD.toUpperCase()), /exact 40-character lowercase/);
  assert.throws(() => parseMergeGateArguments([]), /Usage:/);
  assert.throws(
    () => parseMergeGateArguments(["--head", HEAD.slice(0, 12)]),
    /exact 40-character lowercase hexadecimal SHA/
  );
  assert.throws(() => parseMergeGateJson(""), /must be non-empty JSON/);
  assert.throws(() => parseMergeGateJson("{"), /must be valid JSON/);

  for (const result of [
    runCli(mergeGateInput(), []),
    runCli(mergeGateInput(), ["--head", HEAD.slice(0, 12)]),
    runCli("", ["--head", HEAD]),
    runCli("{", ["--head", HEAD])
  ]) {
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Merge gate check error:/);
  }
});

test("malformed input shapes fail strictly", () => {
  const cases = [
    {
      input: [],
      message: /Merge gate input must be a JSON object/
    },
    {
      input: mergeGateInput({ isDraft: "false" }),
      message: /field "isDraft" must be a boolean/
    },
    {
      input: mergeGateInput({ headRefOid: HEAD.slice(0, 12) }),
      message: /field "headRefOid" must be an exact 40-character/
    },
    {
      input: mergeGateInput({ statusCheckRollup: null }),
      message: /field "statusCheckRollup" must be an array/
    },
    {
      input: mergeGateInput({
        statusCheckRollup: [{ __typename: "UnknownCheck", name: "quality" }]
      }),
      message: /must be "CheckRun" or "StatusContext"/
    },
    {
      input: mergeGateInput({
        statusCheckRollup: [
          {
            __typename: "CheckRun",
            name: "quality",
            status: "COMPLETED"
          }
        ]
      }),
      message: /statusCheckRollup\[0\] must include field "conclusion"/
    }
  ];

  for (const { input, message } of cases) {
    const result = runCli(input);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, message);
  }
});
