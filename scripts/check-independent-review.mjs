import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FULL_HEAD_PATTERN = /^[0-9a-f]{40}$/;
const FULL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PULL_REQUEST_NUMBER_PATTERN = /^[1-9][0-9]*$/;
const MARKER_PREFIX = "independent-review head=";
const UUID_PATTERN_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXACT_MARKER_LINE_PATTERN = new RegExp(
  `^${MARKER_PREFIX}([0-9a-f]{40}) verdict=(pass|fail) by=(${UUID_PATTERN_SOURCE})$`
);
const MARKDOWN_CONTAINER_PREFIX_PATTERN =
  /^(?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+))+/;
const SECOND_VERDICT_PATTERN = /^(?:pass|fail)(?![A-Za-z0-9_-])/;
const VERDICT_SEPARATOR_PATTERN =
  /^(?:[ \t\r\n]*[|/,、;；][ \t\r\n]*|[ \t\r\n]+)(?:or[ \t\r\n]+)?/;
const SURFACES = ["reviews", "comments"];
const CURRENT_PULL_REQUEST_STATES = new Set(["open", "closed"]);
const MAX_EVIDENCE_ENTRIES = 100;
const GH_TIMEOUT_MS = 20_000;
const GH_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const USAGE = [
  "Usage:",
  "  gh pr view <N> --json reviews,comments | node scripts/check-independent-review.mjs --head <40-character-head>",
  "  node scripts/check-independent-review.mjs --repo <owner/name> --pr <number> --head <40-character-head> [--input <path|->]"
].join("\n");

export function validateHeadSha(head) {
  if (typeof head !== "string" || !FULL_HEAD_PATTERN.test(head)) {
    throw new TypeError("--head must be an exact 40-character lowercase hexadecimal SHA");
  }

  return head;
}

export function validateReviewerSessionId(sessionId) {
  if (typeof sessionId !== "string" || !FULL_UUID_PATTERN.test(sessionId)) {
    throw new TypeError("reviewer identity must be a full lowercase UUID");
  }

  return sessionId;
}

function validateRepository(repository) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
    throw new TypeError("--repo must use owner/name form");
  }

  return repository;
}

function validatePullRequestNumber(pullRequestNumber) {
  const source = String(pullRequestNumber);
  if (!PULL_REQUEST_NUMBER_PATTERN.test(source)) {
    throw new TypeError("--pr must be a positive integer");
  }

  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError("--pr must be a safe positive integer");
  }

  return parsed;
}

export function parseReviewEvidenceJson(source) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new TypeError(
      "Review evidence input must be non-empty JSON from gh pr view --json reviews,comments"
    );
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`Review evidence input must be valid JSON: ${error.message}`, {
      cause: error
    });
  }
}

function normalizeFenceCandidate(line) {
  return line.replace(MARKDOWN_CONTAINER_PREFIX_PATTERN, "").trimStart();
}

function parseOpeningFence(line) {
  const match = normalizeFenceCandidate(line).match(/^(`{3,}|~{3,})(.*)$/);
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) {
    return null;
  }

  return {
    character: match[1][0],
    length: match[1].length
  };
}

function closesFence(line, fence) {
  const match = normalizeFenceCandidate(line).match(/^(`{3,}|~{3,})[ \t]*$/);

  return (
    match !== null && match[1][0] === fence.character && match[1].length >= fence.length
  );
}

function hasSecondVerdictAfterSeparator(suffix) {
  const separatorMatch = suffix.match(VERDICT_SEPARATOR_PATTERN);

  return (
    separatorMatch !== null &&
    SECOND_VERDICT_PATTERN.test(suffix.slice(separatorMatch[0].length))
  );
}

function collectStandaloneVerdicts(body, head) {
  const matches = [];
  let fence = null;
  let lineStart = 0;

  while (lineStart <= body.length) {
    let lineEnd = lineStart;
    while (lineEnd < body.length && body[lineEnd] !== "\r" && body[lineEnd] !== "\n") {
      lineEnd += 1;
    }

    const line = body.slice(lineStart, lineEnd);
    if (fence) {
      if (closesFence(line, fence)) {
        fence = null;
      }
    } else {
      const openingFence = parseOpeningFence(line);
      if (openingFence) {
        fence = openingFence;
      } else {
        const trimmedLine = line.trim();
        const markerMatch = trimmedLine.match(EXACT_MARKER_LINE_PATTERN);

        if (markerMatch && markerMatch[1] === head) {
          const offset = lineStart + line.indexOf(trimmedLine);
          const suffix = body.slice(offset + trimmedLine.length);
          if (!hasSecondVerdictAfterSeparator(suffix)) {
            matches.push({
              verdict: markerMatch[2],
              by: validateReviewerSessionId(markerMatch[3]),
              offset
            });
          }
        }
      }
    }

    if (lineEnd === body.length) {
      break;
    }
    lineStart =
      lineEnd + (body[lineEnd] === "\r" && body[lineEnd + 1] === "\n" ? 2 : 1);
  }

  return matches;
}

export function validateReviewEvidenceInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Review evidence input must be a JSON object");
  }

  for (const surface of SURFACES) {
    const entries = input[surface];
    if (!Array.isArray(entries)) {
      throw new TypeError(`Review evidence input field "${surface}" must be an array`);
    }

    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`Review evidence ${surface}[${index}] must be an object`);
      }

      if (!Object.hasOwn(entry, "body") || entry.body === null) {
        continue;
      }
      if (typeof entry.body !== "string") {
        throw new TypeError(`Review evidence ${surface}[${index}].body must be a string or null`);
      }
    }
  }

  return input;
}

export function collectIndependentReviewEvidence(input, head) {
  validateHeadSha(head);
  validateReviewEvidenceInput(input);

  const evidence = [];

  for (const surface of SURFACES) {
    for (const [index, entry] of input[surface].entries()) {
      if (typeof entry.body !== "string") {
        continue;
      }

      for (const match of collectStandaloneVerdicts(entry.body, head)) {
        evidence.push({
          surface,
          index,
          verdict: match.verdict,
          by: match.by,
          offset: match.offset
        });
      }
    }
  }

  return evidence;
}

export function evaluateIndependentReviewEvidence(input, head) {
  const evidence = collectIndependentReviewEvidence(input, head);
  const passEvidence = evidence.filter(({ verdict }) => verdict === "pass");
  const failEvidence = evidence.filter(({ verdict }) => verdict === "fail");
  const verdict = failEvidence.length > 0 ? "fail" : passEvidence.length > 0 ? "pass" : "missing";

  return {
    verdict,
    evidence,
    passEvidence,
    failEvidence
  };
}

export function findIndependentReviewEvidence(input, head) {
  const result = evaluateIndependentReviewEvidence(input, head);
  const evidence = result.failEvidence[0] ?? result.passEvidence[0];

  return evidence
    ? { surface: evidence.surface, index: evidence.index, by: evidence.by }
    : null;
}

export function hasIndependentReviewEvidence(input, head) {
  return collectIndependentReviewEvidence(input, head).length > 0;
}

export function parseIndependentReviewArguments(args) {
  if (!Array.isArray(args)) {
    throw new TypeError(USAGE);
  }
  if (args.length === 2 && args[0] === "--head") {
    return {
      mode: "stdin",
      head: validateHeadSha(args[1])
    };
  }

  const values = {};
  const flags = new Map([
    ["--repo", "repository"],
    ["--pr", "pullRequestNumber"],
    ["--head", "head"],
    ["--input", "inputPath"]
  ]);

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = flags.get(flag);
    const value = args[index + 1];
    if (!key || value === undefined || value.startsWith("--") || Object.hasOwn(values, key)) {
      throw new TypeError(USAGE);
    }
    values[key] = value;
  }

  if (!values.repository || !values.pullRequestNumber || !values.head) {
    throw new TypeError(USAGE);
  }

  return {
    mode: "current-pr",
    repository: validateRepository(values.repository),
    pullRequestNumber: validatePullRequestNumber(values.pullRequestNumber),
    head: validateHeadSha(values.head),
    inputPath: values.inputPath
  };
}

async function readStandardInput() {
  let source = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    source += chunk;
  }

  return source;
}

function requireCurrentPullRequestField(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new TypeError(`Current pull request snapshot must include field "${field}"`);
  }

  return input[field];
}

export function validateCurrentPullRequestSnapshot(input) {
  validateReviewEvidenceInput(input);
  const pullRequest = requireCurrentPullRequestField(input, "pullRequest");
  if (!pullRequest || typeof pullRequest !== "object" || Array.isArray(pullRequest)) {
    throw new TypeError('Current pull request snapshot field "pullRequest" must be an object');
  }

  const state = requireCurrentPullRequestField(pullRequest, "state");
  if (typeof state !== "string" || !CURRENT_PULL_REQUEST_STATES.has(state)) {
    throw new TypeError(
      'Current pull request snapshot field "pullRequest.state" must be "open" or "closed"'
    );
  }
  const headSha = requireCurrentPullRequestField(pullRequest, "headSha");
  try {
    validateHeadSha(headSha);
  } catch (error) {
    throw new TypeError(
      'Current pull request snapshot field "pullRequest.headSha" must be an exact 40-character lowercase hexadecimal SHA',
      { cause: error }
    );
  }

  return {
    state,
    headSha,
    reviews: input.reviews,
    comments: input.comments
  };
}

export function evaluateCurrentPullRequestReview(input, expectedHead) {
  validateHeadSha(expectedHead);
  const pullRequest = validateCurrentPullRequestSnapshot(input);

  if (pullRequest.state !== "open") {
    return {
      outcome: "skipped",
      pullRequest,
      independentReview: null
    };
  }
  if (pullRequest.headSha !== expectedHead) {
    return {
      outcome: "stale",
      pullRequest,
      independentReview: null
    };
  }

  const independentReview = evaluateIndependentReviewEvidence(input, expectedHead);
  return {
    outcome: independentReview.verdict,
    pullRequest,
    independentReview
  };
}

function parseGitHubApiResponse(result, endpoint) {
  if (result.error) {
    throw new Error(`GitHub API ${endpoint} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const status =
      result.status === null ? `signal ${result.signal ?? "unknown"}` : `exit ${result.status}`;
    const detail = result.stderr.trim();
    throw new Error(
      `GitHub API ${endpoint} failed (${status})${detail ? `: ${detail}` : ""}`
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new SyntaxError(`GitHub API ${endpoint} returned malformed JSON`, { cause: error });
  }
}

function defaultRunGitHubApi(endpoint) {
  return parseGitHubApiResponse(
    spawnSync("gh", ["api", endpoint], {
      encoding: "utf8",
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER_BYTES
    }),
    endpoint
  );
}

function requireBoundedEvidenceArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`GitHub API ${label} response must be an array`);
  }
  if (value.length >= MAX_EVIDENCE_ENTRIES) {
    throw new RangeError(
      `GitHub API ${label} response reached the ${MAX_EVIDENCE_ENTRIES}-entry safety limit; refusing a possibly truncated snapshot`
    );
  }

  return value;
}

export function fetchCurrentPullRequestSnapshot({
  repository,
  pullRequestNumber,
  runGitHubApi = defaultRunGitHubApi
}) {
  const normalizedRepository = validateRepository(repository);
  const normalizedPullRequestNumber = validatePullRequestNumber(pullRequestNumber);
  const root = `repos/${normalizedRepository}`;
  const pullEndpoint = `${root}/pulls/${normalizedPullRequestNumber}`;
  const reviewsEndpoint = `${pullEndpoint}/reviews?per_page=${MAX_EVIDENCE_ENTRIES}`;
  const commentsEndpoint = `${root}/issues/${normalizedPullRequestNumber}/comments?per_page=${MAX_EVIDENCE_ENTRIES}`;
  const pullRequest = runGitHubApi(pullEndpoint);

  if (
    !pullRequest ||
    typeof pullRequest !== "object" ||
    Array.isArray(pullRequest) ||
    !pullRequest.head ||
    typeof pullRequest.head !== "object" ||
    Array.isArray(pullRequest.head)
  ) {
    throw new TypeError("GitHub API pull request response is missing head data");
  }

  return {
    pullRequest: {
      state: pullRequest.state,
      headSha: pullRequest.head.sha
    },
    reviews: requireBoundedEvidenceArray(runGitHubApi(reviewsEndpoint), "reviews"),
    comments: requireBoundedEvidenceArray(runGitHubApi(commentsEndpoint), "comments")
  };
}

function reviewersFor(evidence) {
  return [...new Set(evidence.map(({ by }) => by))].join(",");
}

function reportIndependentReviewResult(result, head) {
  if (result.verdict === "missing") {
    console.error(
      `Independent review pass verdict not found for head ${head}; expected one exact trimmed marker line outside fenced code blocks in review or comment bodies`
    );
    return 1;
  }
  if (result.verdict === "fail") {
    console.error(
      `Independent review verdict failed for head ${head}: fail=${result.failEvidence.length} pass=${result.passEvidence.length} reviewers=${reviewersFor(result.failEvidence)}`
    );
    return 3;
  }

  const locations = result.passEvidence
    .map(({ surface, index }) => `${surface}[${index}].body`)
    .join(",");
  console.log(
    `Independent review verdict passed for head ${head}: pass=${result.passEvidence.length} reviewers=${reviewersFor(result.passEvidence)} evidence=${locations}`
  );
  return 0;
}

async function readCurrentPullRequestInput(options, dependencies) {
  if (!options.inputPath) {
    return (dependencies.fetchCurrentPullRequestSnapshot ?? fetchCurrentPullRequestSnapshot)({
      repository: options.repository,
      pullRequestNumber: options.pullRequestNumber
    });
  }

  const source =
    options.inputPath === "-" ? await readStandardInput() : await readFile(options.inputPath, "utf8");
  return parseReviewEvidenceJson(source);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runIndependentReviewCheck(
  args = process.argv.slice(2),
  dependencies = {}
) {
  try {
    const options = parseIndependentReviewArguments(args);
    if (options.mode === "stdin") {
      const input = parseReviewEvidenceJson(await readStandardInput());
      return reportIndependentReviewResult(
        evaluateIndependentReviewEvidence(input, options.head),
        options.head
      );
    }

    const input = await readCurrentPullRequestInput(options, dependencies);
    const result = evaluateCurrentPullRequestReview(input, options.head);
    if (result.outcome === "skipped") {
      console.log(
        `Independent review guard skipped: pull request state=${result.pullRequest.state}; only current open pull requests are evaluated`
      );
      return 0;
    }
    if (result.outcome === "stale") {
      console.error(
        `Independent review snapshot head ${result.pullRequest.headSha} does not match expected head ${options.head}`
      );
      return 1;
    }

    return reportIndependentReviewResult(result.independentReview, options.head);
  } catch (error) {
    console.error(`Independent review evidence check error: ${describeError(error)}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runIndependentReviewCheck();
}
