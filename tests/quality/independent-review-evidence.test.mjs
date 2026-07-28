import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  collectIndependentReviewEvidence,
  evaluateCurrentPullRequestReview,
  evaluateIndependentReviewEvidence,
  fetchCurrentPullRequestSnapshot,
  findIndependentReviewEvidence,
  hasIndependentReviewEvidence,
  parseIndependentReviewArguments,
  parseReviewEvidenceJson
} from "../../scripts/check-independent-review.mjs";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/check-independent-review.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "89abcdef0123456789abcdef0123456789abcdef";
const REVIEWER_ID = "c9ebec47-3754-4a61-8588-16a743dafd60";
const OTHER_REVIEWER_ID = "ca416bb8-daf2-4338-9a96-2f3a3f7b363c";
const SECOND_VERDICT_CASES = [
  ["space", "pass", " fail"],
  ["tab", "fail", "\tpass"],
  ["line break", "pass", "\nfail"],
  ["pipe", "pass", "|fail"],
  ["spaced pipe", "fail", " | pass"],
  ["slash", "pass", "/fail"],
  ["spaced slash", "fail", " / pass"],
  ["English or", "pass", " or fail"],
  ["tabbed English or", "fail", "\tor\tpass"],
  ["ASCII comma", "pass", ",fail"],
  ["spaced ASCII comma", "fail", ", pass"],
  ["Japanese comma", "pass", "、fail"],
  ["spaced Japanese comma", "fail", " 、 pass"],
  ["semicolon", "pass", ";fail"],
  ["spaced semicolon", "fail", " ; pass"],
  ["fullwidth semicolon", "pass", "；fail"],
  ["comma plus English or", "fail", ", or pass"]
];

function marker(verdict = "pass", head = HEAD, by = REVIEWER_ID) {
  return `independent-review head=${head} verdict=${verdict} by=${by}`;
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

function currentPullRequestSnapshot(overrides = {}) {
  return {
    pullRequest: {
      state: "open",
      headSha: HEAD
    },
    reviews: [],
    comments: [{ body: marker() }],
    ...overrides
  };
}

function runCurrentPullRequestCli(input, head = HEAD) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--repo",
      "himiyosh/Info",
      "--pr",
      "61",
      "--head",
      head,
      "--input",
      "-"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: typeof input === "string" ? input : JSON.stringify(input)
    }
  );
}

test("pass-only comments evidence satisfies the exact-head verdict", () => {
  const input = {
    reviews: [],
    comments: [{ body: `Independent check complete: ${marker("pass")}` }]
  };

  assert.deepEqual(findIndependentReviewEvidence(input, HEAD), {
    surface: "comments",
    index: 0,
    by: REVIEWER_ID
  });
  assert.deepEqual(evaluateIndependentReviewEvidence(input, HEAD).verdict, "pass");

  const result = runCli(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verdict passed/);
  assert.match(
    result.stdout,
    new RegExp(`pass=1 reviewers=${REVIEWER_ID} evidence=comments\\[0\\]\\.body`)
  );
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
      index: evaluated.failEvidence[0].index,
      by: REVIEWER_ID
    });
    assert.equal(runCli(input).status, 3);
  }
});

test("a retracted fail is ignored while a valid same-head pass succeeds", () => {
  const input = {
    reviews: [
      {
        body: `RETRACTED-${marker("fail")}\nRetraction reason: the original finding was incorrect.`
      }
    ],
    comments: [{ body: marker("pass") }]
  };
  const evaluated = evaluateIndependentReviewEvidence(input, HEAD);

  assert.equal(evaluated.verdict, "pass");
  assert.equal(evaluated.passEvidence.length, 1);
  assert.equal(evaluated.failEvidence.length, 0);
  assert.equal(evaluated.evidence.length, 1);

  const result = runCli(input);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verdict passed/);
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
    evidence.map(({ surface, index, verdict, by }) => ({ surface, index, verdict, by })),
    [
      { surface: "reviews", index: 0, verdict: "pass", by: REVIEWER_ID },
      { surface: "reviews", index: 0, verdict: "fail", by: REVIEWER_ID },
      { surface: "reviews", index: 0, verdict: "pass", by: REVIEWER_ID },
      { surface: "comments", index: 0, verdict: "fail", by: REVIEWER_ID }
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

test("detached verdict syntax in explanation prose or code cannot satisfy a legacy marker", () => {
  const input = {
    reviews: [
      {
        body: `${legacyMarker()}\nExplanation: use \`verdict=pass\` or \`verdict=fail\` after review.`
      },
      {
        body: `${legacyMarker()} -- example code elsewhere: verdict=pass`
      }
    ],
    comments: [
      {
        body: `Documented syntax: verdict=pass|fail\n${legacyMarker()}`
      }
    ]
  };

  assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, "missing");
  assert.equal(collectIndependentReviewEvidence(input, HEAD).length, 0);
  assert.equal(runCli(input).status, 1);
});

test("markers without by or without a full lowercase UUID remain unsatisfied", () => {
  const invalidMarkers = [
    `independent-review head=${HEAD} verdict=pass`,
    marker("pass", HEAD, REVIEWER_ID.toUpperCase()),
    marker("pass", HEAD, REVIEWER_ID.slice(0, 18)),
    marker("pass", HEAD, `{${REVIEWER_ID}}`),
    marker("pass", HEAD, `${REVIEWER_ID}suffix`)
  ];

  for (const body of invalidMarkers) {
    const input = { reviews: [], comments: [{ body }] };
    assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, "missing", body);
    assert.equal(runCli(input).status, 1, body);
  }
});

test("a separator followed by a second verdict invalidates the exact-head marker", () => {
  for (const [label, verdict, continuation] of SECOND_VERDICT_CASES) {
    const input = {
      reviews: [],
      comments: [{ body: `${marker(verdict)}${continuation}` }]
    };

    assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, "missing", label);
    assert.equal(collectIndependentReviewEvidence(input, HEAD).length, 0, label);
  }

  const result = runCli({
    reviews: [],
    comments: [{ body: `${marker("pass")};fail` }]
  });
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
      {
        body: `independent-review head=${HEAD.slice(0, 12)} verdict=pass by=${REVIEWER_ID}`
      },
      { body: `not-${marker("pass")}` },
      { body: legacyMarker() },
      { body: `${marker("pass")}age` }
    ],
    comments: [
      { body: `${marker("fail")}-safe` },
      { body: `prefix${marker("pass")}suffix` },
      { body: `independent-review head=${HEAD} verdict=PASS by=${REVIEWER_ID}` }
    ]
  };

  assert.equal(hasIndependentReviewEvidence(input, HEAD), false);
});

test("non-verdict punctuation and prose preserve single pass and fail verdicts", () => {
  const cases = [
    { body: `${marker("pass")}, review complete.`, verdict: "pass" },
    { body: `${marker("pass")}、レビュー完了。`, verdict: "pass" },
    { body: `${marker("pass")}; failures: none.`, verdict: "pass" },
    { body: `${marker("pass")}| passing checks complete.`, verdict: "pass" },
    { body: `${marker("pass")}/ review complete.`, verdict: "pass" },
    { body: `${marker("pass")} or continue with the merge gate.`, verdict: "pass" },
    { body: `(${marker("pass")}).`, verdict: "pass" },
    { body: `${marker("pass")}!`, verdict: "pass" },
    { body: `| Result | ${marker("pass")} | Review complete |`, verdict: "pass" },
    { body: `${marker("fail")}, blocking issue remains.`, verdict: "fail" },
    { body: `${marker("fail")}、修正が必要です。`, verdict: "fail" },
    { body: `${marker("fail")}; blocking issue remains.`, verdict: "fail" }
  ];

  // A delimiter is blocked only when it begins a second valid verdict token, preserving prose and Markdown cells.
  for (const { body, verdict } of cases) {
    const input = { reviews: [{ body }], comments: [] };
    assert.equal(evaluateIndependentReviewEvidence(input, HEAD).verdict, verdict, body);
  }

  assert.equal(runCli({ reviews: [{ body: cases[8].body }], comments: [] }).status, 0);
  assert.equal(runCli({ reviews: [{ body: cases[10].body }], comments: [] }).status, 3);
});

test("current open PR mode passes only exact-head pass evidence and skips closed snapshots", () => {
  const open = currentPullRequestSnapshot();
  const evaluated = evaluateCurrentPullRequestReview(open, HEAD);

  assert.equal(evaluated.outcome, "pass");
  assert.equal(evaluated.independentReview.passEvidence[0].by, REVIEWER_ID);
  const passing = runCurrentPullRequestCli(open);
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, new RegExp(`reviewers=${REVIEWER_ID}`));

  const closed = currentPullRequestSnapshot({
    pullRequest: { state: "closed", headSha: HEAD },
    comments: [{ body: marker("fail") }]
  });
  assert.equal(evaluateCurrentPullRequestReview(closed, HEAD).outcome, "skipped");
  const skipped = runCurrentPullRequestCli(closed);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /guard skipped: pull request state=closed/);
});

test("current open PR mode fails for missing, malformed, fail, stale, and unusable snapshots", () => {
  const cases = [
    {
      label: "missing marker",
      input: currentPullRequestSnapshot({ comments: [] }),
      status: 1,
      message: /pass verdict not found/
    },
    {
      label: "marker without reviewer",
      input: currentPullRequestSnapshot({
        comments: [{ body: `independent-review head=${HEAD} verdict=pass` }]
      }),
      status: 1,
      message: /pass verdict not found/
    },
    {
      label: "invalid reviewer UUID",
      input: currentPullRequestSnapshot({
        comments: [{ body: marker("pass", HEAD, OTHER_REVIEWER_ID.toUpperCase()) }]
      }),
      status: 1,
      message: /pass verdict not found/
    },
    {
      label: "same-head fail",
      input: currentPullRequestSnapshot({ comments: [{ body: marker("fail") }] }),
      status: 3,
      message: /verdict failed/
    },
    {
      label: "stale head",
      input: currentPullRequestSnapshot({
        pullRequest: { state: "open", headSha: OTHER_HEAD }
      }),
      status: 1,
      message: /does not match expected head/
    },
    {
      label: "unusable state",
      input: currentPullRequestSnapshot({
        pullRequest: { state: "OPEN", headSha: HEAD }
      }),
      status: 2,
      message: /must be "open" or "closed"/
    },
    {
      label: "unusable evidence body",
      input: currentPullRequestSnapshot({ comments: [{ body: 42 }] }),
      status: 2,
      message: /body must be a string or null/
    }
  ];

  for (const { label, input, status, message } of cases) {
    const result = runCurrentPullRequestCli(input);
    assert.equal(result.status, status, label);
    assert.match(result.stderr, message, label);
  }
});

test("current PR arguments and API collection are strict and bounded", () => {
  assert.deepEqual(parseIndependentReviewArguments(["--head", HEAD]), {
    mode: "stdin",
    head: HEAD
  });
  assert.deepEqual(
    parseIndependentReviewArguments([
      "--pr",
      "61",
      "--head",
      HEAD,
      "--repo",
      "himiyosh/Info",
      "--input",
      "-"
    ]),
    {
      mode: "current-pr",
      repository: "himiyosh/Info",
      pullRequestNumber: 61,
      head: HEAD,
      inputPath: "-"
    }
  );
  assert.throws(
    () => parseIndependentReviewArguments(["--repo", "himiyosh/Info", "--head", HEAD]),
    /Usage:/
  );

  const endpoints = [];
  const snapshot = fetchCurrentPullRequestSnapshot({
    repository: "himiyosh/Info",
    pullRequestNumber: 61,
    runGitHubApi(endpoint) {
      endpoints.push(endpoint);
      if (endpoint.endsWith("/pulls/61")) {
        return { state: "open", head: { sha: HEAD } };
      }
      return [];
    }
  });
  assert.deepEqual(snapshot, {
    pullRequest: { state: "open", headSha: HEAD },
    reviews: [],
    comments: []
  });
  assert.deepEqual(endpoints, [
    "repos/himiyosh/Info/pulls/61",
    "repos/himiyosh/Info/pulls/61/reviews?per_page=100",
    "repos/himiyosh/Info/issues/61/comments?per_page=100"
  ]);

  assert.throws(
    () =>
      fetchCurrentPullRequestSnapshot({
        repository: "himiyosh/Info",
        pullRequestNumber: 61,
        runGitHubApi(endpoint) {
          if (endpoint.endsWith("/pulls/61")) {
            return { state: "open", head: { sha: HEAD } };
          }
          if (endpoint.includes("/reviews?")) {
            return Array.from({ length: 100 }, () => ({ body: null }));
          }
          return [];
        }
      }),
    /100-entry safety limit/
  );
});
