import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  findIndependentReviewEvidence,
  hasIndependentReviewEvidence,
  parseReviewEvidenceJson
} from "../../scripts/check-independent-review.mjs";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/check-independent-review.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";

function marker(head = HEAD) {
  return `independent-review head=${head}`;
}

function runCli(input, head = HEAD) {
  return spawnSync(process.execPath, [scriptPath, "--head", head], {
    cwd: repoRoot,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input)
  });
}

test("comments-only evidence passes when reviews are empty", () => {
  const input = {
    reviews: [],
    comments: [{ body: `Independent check complete: ${marker()}` }]
  };

  assert.deepEqual(findIndependentReviewEvidence(input, HEAD), {
    surface: "comments",
    index: 0
  });

  const result = runCli(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /comments\[0\]\.body/);
});

test("review evidence passes when comments are empty", () => {
  const input = {
    reviews: [{ body: marker() }],
    comments: []
  };

  assert.deepEqual(findIndependentReviewEvidence(input, HEAD), {
    surface: "reviews",
    index: 0
  });
});

test("wrong-head evidence fails with a non-success exit", () => {
  const input = {
    reviews: [{ body: marker(OTHER_HEAD) }],
    comments: []
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);

  const result = runCli(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`not found for head ${HEAD}`));
});

test("absent and null bodies do not count as evidence", () => {
  const input = {
    reviews: [{}, { body: null }],
    comments: [{}, { body: null }]
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);
  assert.equal(runCli(input).status, 1);
});

test("malformed heads and input fail clearly", () => {
  assert.throws(
    () => findIndependentReviewEvidence({ reviews: [], comments: [] }, HEAD.slice(0, 12)),
    /exact 40-character lowercase hexadecimal SHA/
  );
  assert.throws(
    () => findIndependentReviewEvidence({ reviews: [] }, HEAD),
    /field "comments" must be an array/
  );
  assert.throws(() => parseReviewEvidenceJson("{"), /must be valid JSON/);

  const invalidHeadResult = runCli({ reviews: [], comments: [] }, HEAD.slice(0, 12));
  assert.equal(invalidHeadResult.status, 2);
  assert.match(invalidHeadResult.stderr, /evidence check error: --head must be an exact/);

  const invalidJsonResult = runCli("{");
  assert.equal(invalidJsonResult.status, 2);
  assert.match(invalidJsonResult.stderr, /evidence check error: Review evidence input must be valid/);
});

test("short and substring markers do not produce false positives", () => {
  const input = {
    reviews: [
      { body: `independent-review head=${HEAD.slice(0, 12)}` },
      { body: `not-${marker()}` }
    ],
    comments: [
      { body: `${marker()}a` },
      { body: `prefix${marker()}suffix` }
    ]
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);
});
