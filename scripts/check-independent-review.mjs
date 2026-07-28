import { pathToFileURL } from "node:url";

const FULL_HEAD_PATTERN = /^[0-9a-f]{40}$/;
const MARKER_PREFIX = "independent-review head=";
const TOKEN_CHARACTER_PATTERN = /[A-Za-z0-9_-]/;
const VERDICT_SUFFIX_PATTERN = /^ verdict=(pass|fail)(?![A-Za-z0-9_-])/;
const SURFACES = ["reviews", "comments"];
const USAGE =
  "Usage: gh pr view <N> --json reviews,comments | node scripts/check-independent-review.mjs --head <40-character-head>";

export function validateHeadSha(head) {
  if (typeof head !== "string" || !FULL_HEAD_PATTERN.test(head)) {
    throw new TypeError("--head must be an exact 40-character lowercase hexadecimal SHA");
  }

  return head;
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

function collectStandaloneVerdicts(body, head) {
  const marker = `${MARKER_PREFIX}${head}`;
  const matches = [];
  let index = body.indexOf(marker);

  while (index !== -1) {
    const precedingCharacter = body[index - 1];
    const hasValidStart =
      precedingCharacter === undefined || !TOKEN_CHARACTER_PATTERN.test(precedingCharacter);
    const suffixMatch = body.slice(index + marker.length).match(VERDICT_SUFFIX_PATTERN);

    if (hasValidStart && suffixMatch) {
      matches.push({ verdict: suffixMatch[1], offset: index });
    }

    index = body.indexOf(marker, index + 1);
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

  return evidence ? { surface: evidence.surface, index: evidence.index } : null;
}

export function hasIndependentReviewEvidence(input, head) {
  return collectIndependentReviewEvidence(input, head).length > 0;
}

function parseHeadArgument(args) {
  if (args.length !== 2 || args[0] !== "--head") {
    throw new TypeError(USAGE);
  }

  return validateHeadSha(args[1]);
}

async function readStandardInput() {
  let source = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    source += chunk;
  }

  return source;
}

export async function runIndependentReviewCheck(args = process.argv.slice(2)) {
  try {
    const head = parseHeadArgument(args);
    const input = parseReviewEvidenceJson(await readStandardInput());
    const result = evaluateIndependentReviewEvidence(input, head);

    if (result.verdict === "missing") {
      console.error(
        `Independent review pass verdict not found for head ${head} in review or comment bodies`
      );
      return 1;
    }

    if (result.verdict === "fail") {
      console.error(
        `Independent review verdict failed for head ${head}: fail=${result.failEvidence.length} pass=${result.passEvidence.length}`
      );
      return 3;
    }

    const locations = result.passEvidence
      .map(({ surface, index }) => `${surface}[${index}].body`)
      .join(",");
    console.log(
      `Independent review verdict passed for head ${head}: pass=${result.passEvidence.length} evidence=${locations}`
    );
    return 0;
  } catch (error) {
    console.error(`Independent review evidence check error: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runIndependentReviewCheck();
}
