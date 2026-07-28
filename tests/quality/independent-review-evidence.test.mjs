import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  collectIndependentReviewEvidence,
  evaluateIndependentReviewEvidence,
  findIndependentReviewEvidence,
  hasIndependentReviewEvidence,
  parseReviewEvidenceJson
} from "../../scripts/check-independent-review.mjs";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/check-independent-review.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";

function marker(verdict = "pass", head = HEAD) {
  return `independent-review head=${head} verdict=${verdict}`;
}

function legacyMarker(head = HEAD) {
  return `independent-review head=${head}`;
}

function runCli(input, head = HEAD) {
  return spawnSync(process.execPath, [scriptPath, "--head", head], {
    cwd: repoRoot,
    encoding: "utf8",
    input: typeof input === "string" ? input : JSON.stringify(input)
  });
}

test("pass-only comments evidence satisfies the exact-head verdict", () => {
  const input = {
    reviews: [],
    comments: [{ body: `Independent check complete: ${marker("pass")}` }]
  };

  assert.deepEqual(findIndependentReviewEvidence(input, HEAD), {
    surface: "comments",
    index: 0
  });
  assert.deepEqual(evaluateIndependentReviewEvidence(input, HEAD).verdict, "pass");

  const result = runCli(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verdict passed/);
  assert.match(result.stdout, /pass=1 evidence=comments\[0\]\.body/);
});

test("pass-only review evidence satisfies the exact-head verdict", () => {
  const input = {
    reviews: [{ body: marker("pass") }],
    comments: []
  };

  const result = evaluateIndependentReviewEvidence(input, HEAD);
  assert.equal(result.verdict, "pass");
  assert.equal(result.passEvidence.length, 1);
  assert.equal(result.failEvidence.length, 0);
});

test("fail-only evidence returns the dedicated failure exit", () => {
  const input = {
    reviews: [],
    comments: [{ body: marker("fail") }]
  };
  const evaluated = evaluateIndependentReviewEvidence(input, HEAD);

  assert.equal(evaluated.verdict, "fail");
  assert.equal(evaluated.failEvidence.length, 1);
  assert.equal(hasIndependentReviewEvidence(input, HEAD), true);

  const result = runCli(input);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /verdict failed/);
  assert.match(result.stderr, /fail=1 pass=0/);
});

test("fail wins over pass regardless of evidence order or surface", () => {
  const inputs = [
    {
      reviews: [{ body: marker("fail") }],
      comments: [{ body: marker("pass") }]
    },
    {
      reviews: [{ body: marker("pass") }],
      comments: [{ body: marker("fail") }]
    }
  ];

  for (const input of inputs) {
    const evaluated = evaluateIndependentReviewEvidence(input, HEAD);
    assert.equal(evaluated.verdict, "fail");
    assert.equal(evaluated.passEvidence.length, 1);
    assert.equal(evaluated.failEvidence.length, 1);
    assert.deepEqual(findIndependentReviewEvidence(input, HEAD), {
      surface: evaluated.failEvidence[0].surface,
      index: evaluated.failEvidence[0].index
    });
    assert.equal(runCli(input).status, 3);
  }
});

test("all verdict-bearing evidence is collected in source order", () => {
  const body = [marker("pass"), marker("fail"), marker("pass")].join("\n");
  const evidence = collectIndependentReviewEvidence(
    {
      reviews: [{ body }],
      comments: [{ body: marker("fail") }]
    },
    HEAD
  );

  assert.deepEqual(
    evidence.map(({ surface, index, verdict }) => ({ surface, index, verdict })),
    [
      { surface: "reviews", index: 0, verdict: "pass" },
      { surface: "reviews", index: 0, verdict: "fail" },
      { surface: "reviews", index: 0, verdict: "pass" },
      { surface: "comments", index: 0, verdict: "fail" }
    ]
  );
});

test("legacy markers without a verdict remain unsatisfied", () => {
  const input = {
    reviews: [{ body: legacyMarker() }],
    comments: []
  };

  assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, "missing");
  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);

  const result = runCli(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pass verdict not found/);
});

test("wrong-head verdict evidence remains unsatisfied", () => {
  const input = {
    reviews: [{ body: marker("pass", OTHER_HEAD) }],
    comments: []
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);

  const result = runCli(input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`pass verdict not found for head ${HEAD}`));
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

test("short, legacy, malformed-verdict, and substring markers do not produce false positives", () => {
  const input = {
    reviews: [
      { body: `independent-review head=${HEAD.slice(0, 12)} verdict=pass` },
      { body: `not-${marker("pass")}` },
      { body: legacyMarker() },
      { body: `${marker("pass")}age` }
    ],
    comments: [
      { body: `${marker("fail")}-safe` },
      { body: `prefix${marker("pass")}suffix` },
      { body: `independent-review head=${HEAD} verdict=PASS` }
    ]
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);
});

test("punctuation-delimited verdict markers retain standalone boundary support", () => {
  const input = {
    reviews: [{ body: `(${marker("pass")})` }],
    comments: []
  };

  assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, "pass");
});
