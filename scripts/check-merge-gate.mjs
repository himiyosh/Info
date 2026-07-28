import { pathToFileURL } from "node:url";

import {
  evaluateIndependentReviewEvidence,
  validateHeadSha
} from "./check-independent-review.mjs";

const USAGE =
  "Usage: gh pr view <N> --json state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments | node scripts/check-merge-gate.mjs --head <40-character-head>";

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }

  return value;
}

function requireField(input, field, label = "Merge gate input") {
  if (!Object.hasOwn(input, field)) {
    throw new TypeError(`${label} must include field "${field}"`);
  }

  return input[field];
}

function requireNonEmptyString(input, field, label = "Merge gate input") {
  const value = requireField(input, field, label);
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} field "${field}" must be a non-empty string`);
  }

  return value;
}

function requireBoolean(input, field) {
  const value = requireField(input, field);
  if (typeof value !== "boolean") {
    throw new TypeError(`Merge gate input field "${field}" must be a boolean`);
  }

  return value;
}

function requireArray(input, field) {
  const value = requireField(input, field);
  if (!Array.isArray(value)) {
    throw new TypeError(`Merge gate input field "${field}" must be an array`);
  }

  return value;
}

function formatValue(value) {
  return value === null ? "null" : JSON.stringify(value);
}

function validateCheckRun(check, index) {
  const label = `Merge gate input statusCheckRollup[${index}]`;
  requireObject(check, label);
  const type = requireNonEmptyString(check, "__typename", label);

  if (type === "CheckRun") {
    const name = requireNonEmptyString(check, "name", label);
    const status = requireNonEmptyString(check, "status", label);
    const conclusion = requireField(check, "conclusion", label);
    if (conclusion !== null && typeof conclusion !== "string") {
      throw new TypeError(`${label} field "conclusion" must be a string or null`);
    }

    return {
      type,
      name,
      successful: status === "COMPLETED" && conclusion === "SUCCESS",
      actual: `status=${formatValue(status)} conclusion=${formatValue(conclusion)}`,
      expected: 'status="COMPLETED" conclusion="SUCCESS"'
    };
  }

  if (type === "StatusContext") {
    const name = requireNonEmptyString(check, "context", label);
    const state = requireNonEmptyString(check, "state", label);

    return {
      type,
      name,
      successful: state === "SUCCESS",
      actual: `state=${formatValue(state)}`,
      expected: 'state="SUCCESS"'
    };
  }

  throw new TypeError(
    `${label} field "__typename" must be "CheckRun" or "StatusContext"; received ${formatValue(type)}`
  );
}

export function parseMergeGateJson(source) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new TypeError(
      "Merge gate input must be non-empty JSON from gh pr view --json state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments"
    );
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`Merge gate input must be valid JSON: ${error.message}`, {
      cause: error
    });
  }
}

export function parseMergeGateArguments(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "--head") {
    throw new TypeError(USAGE);
  }

  return validateHeadSha(args[1]);
}

export function validateMergeGateInput(input) {
  requireObject(input, "Merge gate input");

  const state = requireNonEmptyString(input, "state");
  const isDraft = requireBoolean(input, "isDraft");
  const headRefOid = requireNonEmptyString(input, "headRefOid");
  try {
    validateHeadSha(headRefOid);
  } catch (error) {
    throw new TypeError(
      'Merge gate input field "headRefOid" must be an exact 40-character lowercase hexadecimal SHA',
      { cause: error }
    );
  }
  const mergeable = requireNonEmptyString(input, "mergeable");
  const mergeStateStatus = requireNonEmptyString(input, "mergeStateStatus");
  const checks = requireArray(input, "statusCheckRollup").map(validateCheckRun);

  return {
    state,
    isDraft,
    headRefOid,
    mergeable,
    mergeStateStatus,
    checks
  };
}

export function evaluateMergeGate(input, expectedHead) {
  validateHeadSha(expectedHead);
  const pullRequest = validateMergeGateInput(input);
  const independentReview = evaluateIndependentReviewEvidence(input, expectedHead);
  const failures = [];

  if (pullRequest.state !== "OPEN") {
    failures.push(`state=${formatValue(pullRequest.state)}; expected "OPEN"`);
  }
  if (pullRequest.isDraft) {
    failures.push('isDraft=true; expected false');
  }
  if (pullRequest.headRefOid !== expectedHead) {
    failures.push(
      `headRefOid=${formatValue(pullRequest.headRefOid)}; expected exact --head ${formatValue(expectedHead)}`
    );
  }
  if (pullRequest.mergeable !== "MERGEABLE") {
    failures.push(
      `mergeable=${formatValue(pullRequest.mergeable)}; expected "MERGEABLE"`
    );
  }
  if (pullRequest.mergeStateStatus !== "CLEAN") {
    failures.push(
      `mergeStateStatus=${formatValue(pullRequest.mergeStateStatus)}; expected "CLEAN"`
    );
  }
  if (pullRequest.checks.length === 0) {
    failures.push("statusCheckRollup reports no checks; at least one successful check is required");
  }
  pullRequest.checks.forEach((check, index) => {
    if (!check.successful) {
      failures.push(
        `statusCheckRollup[${index}] ${formatValue(check.name)} has ${check.actual}; expected ${check.expected}`
      );
    }
  });
  if (independentReview.verdict === "missing") {
    failures.push(
      `independent review verdict=pass not found for exact head ${expectedHead} in review or comment bodies`
    );
  }
  if (independentReview.verdict === "fail") {
    const reviewers = [...new Set(independentReview.failEvidence.map(({ by }) => by))].join(",");
    failures.push(
      `independent review verdict=fail found for exact head ${expectedHead}: fail=${independentReview.failEvidence.length} pass=${independentReview.passEvidence.length} reviewers=${reviewers}`
    );
  }

  return {
    ok: failures.length === 0,
    expectedHead,
    pullRequest,
    independentReview,
    failures
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

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runMergeGateCheck(args = process.argv.slice(2)) {
  try {
    const expectedHead = parseMergeGateArguments(args);
    const input = parseMergeGateJson(await readStandardInput());
    const result = evaluateMergeGate(input, expectedHead);

    if (!result.ok) {
      console.error(["Merge gate blocked:", ...result.failures.map((failure) => `- ${failure}`)].join("\n"));
      return result.independentReview.verdict === "fail" ? 3 : 1;
    }

    const locations = result.independentReview.passEvidence
      .map(({ surface, index }) => `${surface}[${index}].body`)
      .join(",");
    const reviewers = [
      ...new Set(result.independentReview.passEvidence.map(({ by }) => by))
    ].join(",");
    console.log(
      `Merge gate satisfied: head=${expectedHead} state=OPEN isDraft=false mergeable=MERGEABLE mergeStateStatus=CLEAN checks=${result.pullRequest.checks.length}/${result.pullRequest.checks.length} reviewVerdict=pass reviewers=${reviewers} evidence=${locations}`
    );
    return 0;
  } catch (error) {
    console.error(`Merge gate check error: ${describeError(error)}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMergeGateCheck();
}
