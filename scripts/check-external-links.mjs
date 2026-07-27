import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const LINK_FIELDS = ["link", "sourceLink", "proofLink"];
const FALLBACK_STATUSES = new Set([403, 405, 501]);

export const DEFAULT_USER_AGENT =
  "himiyosh-info-link-health/1.0 (+https://github.com/himiyosh/Info)";

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.replace(/\s+/g, " ").trim();
  }
  return String(error).replace(/\s+/g, " ").trim();
}

function isSuccessfulStatus(status) {
  return status >= 200 && status < 400;
}

function isTransientFailure(result) {
  return (
    result.kind !== "http" ||
    result.status === 429 ||
    (result.status >= 500 && result.status < 600)
  );
}

function formatFailure(failure) {
  const status =
    failure.status === "timeout"
      ? `timeout after ${failure.timeoutMs}ms`
      : failure.status === "network-error"
        ? "network error"
        : `HTTP ${failure.status}`;
  const detail = failure.detail ? ` detail="${failure.detail}"` : "";

  return `- slug=${failure.slug} field=${failure.field} url=${failure.url} method=${failure.method} status=${status} attempts=${failure.attempts}${detail}`;
}

export class LinkHealthError extends Error {
  constructor(failures, total) {
    super(
      [
        `External link health check failed for ${failures.length} of ${total} destinations:`,
        ...failures.map(formatFailure)
      ].join("\n")
    );
    this.name = "LinkHealthError";
    this.failures = failures;
    this.total = total;
  }
}

export function collectProjectLinks(projects) {
  if (!Array.isArray(projects)) {
    throw new TypeError("projects.json must contain an array");
  }

  const links = [];
  projects.forEach((project, index) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new TypeError(`Project ${index + 1} must be an object`);
    }
    if (typeof project.slug !== "string" || project.slug.trim() === "") {
      throw new TypeError(`Project ${index + 1} must have a non-empty slug`);
    }

    for (const field of LINK_FIELDS) {
      if (!Object.hasOwn(project, field)) {
        continue;
      }

      const value = project[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`Project ${project.slug} field ${field} must be a non-empty URL`);
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(value);
      } catch (error) {
        throw new TypeError(
          `Project ${project.slug} field ${field} must be an absolute URL: ${value}`,
          { cause: error }
        );
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new TypeError(
          `Project ${project.slug} field ${field} must use HTTP or HTTPS: ${value}`
        );
      }

      links.push({ slug: project.slug, field, url: value });
    }
  });

  return links;
}

async function requestDestination(entry, method, options) {
  const {
    fetchImpl,
    timeoutMs,
    userAgent,
    setTimeoutImpl,
    clearTimeoutImpl
  } = options;
  const controller = new AbortController();
  const timeoutId = setTimeoutImpl(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(entry.url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "*/*",
        "User-Agent": userAgent,
        ...(method === "GET" ? { Range: "bytes=0-0" } : {})
      }
    });
    if (response.body && typeof response.body.cancel === "function") {
      await response.body.cancel();
    }

    return {
      kind: "http",
      method,
      status: response.status,
      redirected: response.redirected === true,
      finalUrl: response.url || entry.url
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        kind: "timeout",
        method,
        status: "timeout",
        timeoutMs,
        detail: describeError(error)
      };
    }

    return {
      kind: "network",
      method,
      status: "network-error",
      detail: describeError(error)
    };
  } finally {
    clearTimeoutImpl(timeoutId);
  }
}

export async function checkProjectLink(entry, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retryCount = options.retryCount ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? globalThis.clearTimeout;
  const delayImpl =
    options.delayImpl ??
    ((delay) => new Promise((resolve) => setTimeoutImpl(resolve, delay)));

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 1) {
    throw new RangeError("retryCount must be either 0 or 1");
  }

  const requestOptions = {
    fetchImpl,
    timeoutMs,
    userAgent,
    setTimeoutImpl,
    clearTimeoutImpl
  };
  let finalResult;
  let attempts = 0;

  for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
    attempts = attempt;
    const headResult = await requestDestination(entry, "HEAD", requestOptions);
    finalResult = headResult;

    if (headResult.kind === "http" && isSuccessfulStatus(headResult.status)) {
      return { ...entry, ...headResult, attempts: attempt, ok: true };
    }

    if (headResult.kind === "http" && FALLBACK_STATUSES.has(headResult.status)) {
      const getResult = await requestDestination(entry, "GET", requestOptions);
      finalResult = getResult;
      if (getResult.kind === "http" && isSuccessfulStatus(getResult.status)) {
        return { ...entry, ...getResult, attempts: attempt, ok: true };
      }
    }

    if (attempt > retryCount || !isTransientFailure(finalResult)) {
      break;
    }
    await delayImpl(retryDelayMs);
  }

  return {
    ...entry,
    ...finalResult,
    attempts,
    timeoutMs,
    ok: false
  };
}

export async function checkExternalLinks(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("entries must be an array");
  }

  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const results = new Array(entries.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < entries.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await checkProjectLink(entries[currentIndex], options);
    }
  }

  const workerCount = Math.min(concurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    throw new LinkHealthError(failures, entries.length);
  }

  return results;
}

export async function runCli(options = {}) {
  const {
    projects: providedProjects,
    projectsUrl = new URL("../projects.json", import.meta.url),
    readFileImpl = readFile,
    stdout = process.stdout,
    stderr = process.stderr,
    ...checkOptions
  } = options;

  try {
    const projects =
      providedProjects ??
      JSON.parse(await readFileImpl(projectsUrl, "utf8"));
    const entries = collectProjectLinks(projects);
    if (entries.length === 0) {
      throw new Error("projects.json does not contain any external destinations");
    }

    await checkExternalLinks(entries, checkOptions);
    stdout.write(`External link health check passed: ${entries.length} destinations reachable.\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
