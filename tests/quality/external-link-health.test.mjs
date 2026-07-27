import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_USER_AGENT,
  LinkHealthError,
  checkExternalLinks,
  checkProjectLink,
  collectProjectLinks,
  runCli
} from "../../scripts/check-external-links.mjs";

const repoRoot = process.cwd();
const workflowPath = ".github/workflows/external-link-health.yml";

function response(status, options = {}) {
  return {
    status,
    redirected: options.redirected ?? false,
    url: options.url ?? "https://example.test/final",
    body: null
  };
}

function deterministicOptions(fetchImpl, overrides = {}) {
  let nextTimerId = 0;
  const clearedTimerIds = [];

  return {
    fetchImpl,
    timeoutMs: 50,
    setTimeoutImpl: () => {
      nextTimerId += 1;
      return nextTimerId;
    },
    clearTimeoutImpl: (timerId) => {
      clearedTimerIds.push(timerId);
    },
    delayImpl: async () => {},
    clearedTimerIds,
    ...overrides
  };
}

function writer() {
  let content = "";
  return {
    write(chunk) {
      content += chunk;
    },
    toString() {
      return content;
    }
  };
}

test("collectProjectLinks collects every canonical external URL with its slug and field", async () => {
  const sample = [
    {
      slug: "alpha",
      link: "https://alpha.example/",
      sourceLink: "https://github.com/example/alpha",
      proofLink: "https://github.com/example/alpha/blob/123/file.js#L1-L2"
    },
    {
      slug: "beta",
      link: "https://beta.example/"
    }
  ];

  assert.deepEqual(collectProjectLinks(sample), [
    { slug: "alpha", field: "link", url: "https://alpha.example/" },
    { slug: "alpha", field: "sourceLink", url: "https://github.com/example/alpha" },
    {
      slug: "alpha",
      field: "proofLink",
      url: "https://github.com/example/alpha/blob/123/file.js#L1-L2"
    },
    { slug: "beta", field: "link", url: "https://beta.example/" }
  ]);

  const canonicalProjects = JSON.parse(
    await readFile(path.join(repoRoot, "projects.json"), "utf8")
  );
  const canonicalLinks = collectProjectLinks(canonicalProjects);
  assert.equal(canonicalLinks.length, 23);
  assert.equal(new Set(canonicalLinks.map(({ url }) => url)).size, 23);
  assert.deepEqual(
    canonicalLinks.filter(
      ({ slug, field }) =>
        field === "proofLink" && ["url-decoder", "image-resizer"].includes(slug)
    ),
    [
      {
        slug: "url-decoder",
        field: "proofLink",
        url: "https://github.com/himiyosh/URLDecoder/blob/fa686afa5196dd7dc9432c7ab916d5376dc69954/index.html#L108-L126"
      },
      {
        slug: "image-resizer",
        field: "proofLink",
        url: "https://github.com/himiyosh/ImageResizer/blob/f79765b06964bc1918dad7222f1c657d5d0312ca/index.html#L48-L84"
      }
    ]
  );
});

test("successful HEAD checks use redirects, a clear user agent, and injected timers", async () => {
  const calls = [];
  const options = deterministicOptions(async (url, init) => {
    calls.push({ url, init });
    return response(204);
  });
  const entry = { slug: "alpha", field: "link", url: "https://alpha.example/" };

  const [result] = await checkExternalLinks([entry], options);

  assert.equal(result.ok, true);
  assert.equal(result.method, "HEAD");
  assert.equal(result.attempts, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "follow");
  assert.equal(calls[0].init.headers["User-Agent"], DEFAULT_USER_AGENT);
  assert.equal(calls[0].init.headers.Range, undefined);
  assert.deepEqual(options.clearedTimerIds, [1]);
});

test("followed redirects report the final destination", async () => {
  const entry = { slug: "redirect", field: "link", url: "https://redirect.example/" };
  const options = deterministicOptions(async () =>
    response(200, {
      redirected: true,
      url: "https://destination.example/"
    })
  );

  const result = await checkProjectLink(entry, options);

  assert.equal(result.ok, true);
  assert.equal(result.redirected, true);
  assert.equal(result.finalUrl, "https://destination.example/");
});

test("HEAD rejections fall back to one bounded ranged GET", async () => {
  const entry = { slug: "fallback", field: "sourceLink", url: "https://fallback.example/" };

  for (const headStatus of [403, 405, 501]) {
    const calls = [];
    const statuses = [headStatus, 206];
    const options = deterministicOptions(async (url, init) => {
      calls.push({ url, init });
      return response(statuses.shift());
    });
    const result = await checkProjectLink(entry, options);

    assert.equal(result.ok, true);
    assert.equal(result.method, "GET");
    assert.equal(result.status, 206);
    assert.deepEqual(
      calls.map(({ init }) => init.method),
      ["HEAD", "GET"]
    );
    assert.equal(calls[1].init.headers.Range, "bytes=0-0");
  }
});

test("a timed-out request receives one bounded retry", async () => {
  let requestCount = 0;
  let timerCount = 0;
  const clearedTimerIds = [];
  const retryDelays = [];
  const entry = { slug: "timeout", field: "link", url: "https://timeout.example/" };
  const fetchImpl = async (url, init) => {
    requestCount += 1;
    if (requestCount === 2) {
      return response(200);
    }

    return new Promise((resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true }
      );
    });
  };

  const result = await checkProjectLink(entry, {
    fetchImpl,
    timeoutMs: 25,
    setTimeoutImpl: (callback) => {
      timerCount += 1;
      if (timerCount === 1) {
        queueMicrotask(callback);
      }
      return timerCount;
    },
    clearTimeoutImpl: (timerId) => {
      clearedTimerIds.push(timerId);
    },
    delayImpl: async (delay) => {
      retryDelays.push(delay);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(requestCount, 2);
  assert.deepEqual(retryDelays, [250]);
  assert.deepEqual(clearedTimerIds, [1, 2]);
});

test("transient HTTP failures retry at most once", async () => {
  const statuses = [503, 200];
  const retryDelays = [];
  const entry = { slug: "transient", field: "proofLink", url: "https://transient.example/" };
  const options = deterministicOptions(async () => response(statuses.shift()), {
    delayImpl: async (delay) => {
      retryDelays.push(delay);
    }
  });

  const recovered = await checkProjectLink(entry, options);

  assert.equal(recovered.ok, true);
  assert.equal(recovered.attempts, 2);
  assert.deepEqual(retryDelays, [250]);

  let requestCount = 0;
  const failed = await checkProjectLink(
    entry,
    deterministicOptions(async () => {
      requestCount += 1;
      return response(503);
    })
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 2);
  assert.equal(requestCount, 2);
});

test("network failures receive one bounded retry", async () => {
  let requestCount = 0;
  const entry = { slug: "network", field: "link", url: "https://network.example/" };
  const options = deterministicOptions(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      throw new TypeError("socket closed");
    }
    return response(200);
  });

  const result = await checkProjectLink(entry, options);

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(requestCount, 2);
});

test("bounded concurrency limits simultaneous destination checks", async () => {
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const entries = Array.from({ length: 6 }, (_, index) => ({
    slug: `project-${index}`,
    field: "link",
    url: `https://project-${index}.example/`
  }));
  const options = deterministicOptions(async () => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setImmediate(resolve));
    activeRequests -= 1;
    return response(200);
  }, { concurrency: 2 });

  await checkExternalLinks(entries, options);

  assert.equal(maximumActiveRequests, 2);
});

test("permanent failures include actionable slug, field, URL, status, and attempt diagnostics", async () => {
  const entry = { slug: "missing", field: "link", url: "https://missing.example/" };

  await assert.rejects(
    checkExternalLinks([entry], deterministicOptions(async () => response(404))),
    (error) => {
      assert.ok(error instanceof LinkHealthError);
      assert.match(error.message, /slug=missing/);
      assert.match(error.message, /field=link/);
      assert.match(error.message, /url=https:\/\/missing\.example\//);
      assert.match(error.message, /method=HEAD/);
      assert.match(error.message, /status=HTTP 404/);
      assert.match(error.message, /attempts=1/);
      return true;
    }
  );
});

test("runCli returns explicit success and failure exit codes without live networking", async () => {
  const projects = [{ slug: "cli", link: "https://cli.example/" }];
  const successOutput = writer();
  const successErrors = writer();
  const successCode = await runCli({
    projects,
    stdout: successOutput,
    stderr: successErrors,
    ...deterministicOptions(async () => response(200))
  });

  assert.equal(successCode, 0);
  assert.match(successOutput.toString(), /1 destinations reachable/);
  assert.equal(successErrors.toString(), "");

  const failureOutput = writer();
  const failureErrors = writer();
  const failureCode = await runCli({
    projects,
    stdout: failureOutput,
    stderr: failureErrors,
    ...deterministicOptions(async () => response(404))
  });

  assert.equal(failureCode, 1);
  assert.equal(failureOutput.toString(), "");
  assert.match(failureErrors.toString(), /slug=cli/);
  assert.match(failureErrors.toString(), /status=HTTP 404/);
});

test("package wiring keeps the live network check outside npm test", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["check:links"], "node scripts/check-external-links.mjs");
  assert.match(packageJson.scripts["check:js"], /node --check scripts\/check-external-links\.mjs/);
  assert.doesNotMatch(packageJson.scripts.test, /check:links/);
  assert.doesNotMatch(packageJson.scripts["check:quality"], /check:links/);
});

test("external link workflow remains weekly, manual, pinned, read-only, and bounded", async () => {
  const workflow = await readFile(path.join(repoRoot, workflowPath), "utf8");
  const cron = workflow.match(/cron:\s*["']([^"']+)["']/)?.[1];

  assert.ok(cron, "Workflow must define a quoted cron schedule");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
  assert.match(minute, /^\d+$/);
  assert.notEqual(Number(minute) % 5, 0, "Weekly schedule must use a non-round minute");
  assert.match(hour, /^\d+$/);
  assert.equal(dayOfMonth, "*");
  assert.equal(month, "*");
  assert.match(dayOfWeek, /^[0-6]$/, "Weekly schedule must select one weekday");
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:pull_request|push):/m);

  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^\s+\S+:\s*write\s*$/m);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(workflow, /timeout-minutes:\s*5/);
  assert.match(
    workflow,
    /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/
  );
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(
    workflow,
    /uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/
  );
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d+/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /run:\s*npm run check:links/);
});
