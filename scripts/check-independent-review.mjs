import { pathToFileURL } from "node:url";

const FULL_HEAD_PATTERN = /^[0-9a-f]{40}$/;
const MARKER_PREFIX = "independent-review head=";
const TOKEN_CHARACTER_PATTERN = /[A-Za-z0-9_-]/;
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

function hasStandaloneMarker(body, marker) {
  let index = body.indexOf(marker);

  while (index !== -1) {
    const precedingCharacter = body[index - 1];
    const followingCharacter = body[index + marker.length];
    const hasValidStart =
      precedingCharacter === undefined || !TOKEN_CHARACTER_PATTERN.test(precedingCharacter);
    const hasValidEnd =
      followingCharacter === undefined || !TOKEN_CHARACTER_PATTERN.test(followingCharacter);

    if (hasValidStart && hasValidEnd) {
      return true;
    }

    index = body.indexOf(marker, index + 1);
  }

  return false;
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

export function findIndependentReviewEvidence(input, head) {
  validateHeadSha(head);
  validateReviewEvidenceInput(input);

  const marker = `${MARKER_PREFIX}${head}`;

  for (const surface of SURFACES) {
    for (const [index, entry] of input[surface].entries()) {
      if (typeof entry.body === "string" && hasStandaloneMarker(entry.body, marker)) {
        return { surface, index };
      }
    }
  }

  return null;
}

export function hasIndependentReviewEvidence(input, head) {
  return findIndependentReviewEvidence(input, head) !== null;
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
    const evidence = findIndependentReviewEvidence(input, head);

    if (!evidence) {
      console.error(
        `Independent review marker not found for head ${head} in review or comment bodies`
      );
      return 1;
    }

    console.log(
      `Independent review marker found for head ${head} in ${evidence.surface}[${evidence.index}].body`
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
