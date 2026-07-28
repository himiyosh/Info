import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const defaultMaxStdoutBytes = 10 * 1024 * 1024;
const defaultMaxStderrBytes = 1024 * 1024;
const defaultTimeoutMs = 20_000;
const defaultTerminationGraceMs = 2_000;
const processPollIntervalMs = 25;
const processKillWaitMs = 2_000;

class ChromeJourneyError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = "ChromeJourneyError";
    this.code = code;
  }
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (["EACCES", "ENOENT", "ENOTDIR"].includes(error?.code)) {
        continue;
      }
      throw error;
    }
  }

  throw new ChromeJourneyError(
    `Chrome was not found. Set CHROME_PATH or install it at one of: ${candidates.join(", ")}`,
    "CHROME_NOT_FOUND"
  );
}

function createBoundedCollector({ limit, name, reportFailure }) {
  const chunks = [];
  let capturedBytes = 0;
  let totalBytes = 0;
  let exceeded = false;

  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      const availableBytes = Math.max(0, limit - capturedBytes);
      if (availableBytes > 0) {
        const captured = buffer.subarray(0, availableBytes);
        chunks.push(captured);
        capturedBytes += captured.byteLength;
      }
      if (totalBytes > limit && !exceeded) {
        exceeded = true;
        reportFailure(
          new ChromeJourneyError(
            `Chrome ${name} exceeded the ${limit}-byte safety limit`,
            `CHROME_${name.toUpperCase()}_LIMIT`
          )
        );
      }
    },
    get capturedBytes() {
      return capturedBytes;
    },
    get text() {
      return Buffer.concat(chunks, capturedBytes).toString("utf8");
    },
    get totalBytes() {
      return totalBytes;
    }
  };
}

function isProcessTargetRunning(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function signalProcessTarget(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessTargetToStop(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessTargetRunning(target)) {
      return true;
    }
    await delay(processPollIntervalMs);
  }
  return !isProcessTargetRunning(target);
}

async function stopChromeProcess(chrome, detached, graceMs) {
  if (!Number.isInteger(chrome?.pid) || chrome.pid <= 0) {
    return;
  }
  const target = detached ? -chrome.pid : chrome.pid;
  if (!isProcessTargetRunning(target)) {
    return;
  }

  if (!signalProcessTarget(target, "SIGTERM")) {
    return;
  }
  if (await waitForProcessTargetToStop(target, graceMs)) {
    return;
  }

  if (!signalProcessTarget(target, "SIGKILL")) {
    return;
  }
  if (!(await waitForProcessTargetToStop(target, processKillWaitMs))) {
    throw new ChromeJourneyError(
      `Chrome process target ${target} survived SIGTERM and SIGKILL`,
      "CHROME_CLEANUP_FAILED"
    );
  }
}

function validateChromeArgs(chromeArgs) {
  if (!Array.isArray(chromeArgs) || chromeArgs.some((argument) =>
    typeof argument !== "string" || argument.length === 0
  )) {
    throw new TypeError("chromeArgs must resolve to an array of non-empty strings");
  }
  if (chromeArgs.some((argument) => argument.startsWith("--user-data-dir"))) {
    throw new TypeError("runChromeJourney owns --user-data-dir");
  }
  return chromeArgs;
}

function withJourneyMetadata(error, metadata) {
  const normalized = error instanceof Error
    ? error
    : new ChromeJourneyError(String(error), "CHROME_JOURNEY_FAILED");
  Object.defineProperty(normalized, "chromeJourney", {
    configurable: true,
    enumerable: true,
    value: Object.freeze(metadata)
  });
  return normalized;
}

function errorSummary(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "CHROME_CLEANUP_FAILED",
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error"
  };
}

export async function runChromeJourney({
  chromeArgs: requestedChromeArgs,
  completeWhen,
  maxStderrBytes = defaultMaxStderrBytes,
  maxStdoutBytes = defaultMaxStdoutBytes,
  name = "chrome-journey",
  terminationGraceMs = defaultTerminationGraceMs,
  timeoutMs = defaultTimeoutMs
}) {
  requirePositiveInteger(maxStderrBytes, "maxStderrBytes");
  requirePositiveInteger(maxStdoutBytes, "maxStdoutBytes");
  requirePositiveInteger(terminationGraceMs, "terminationGraceMs");
  requirePositiveInteger(timeoutMs, "timeoutMs");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("name must be a non-empty string");
  }
  if (completeWhen !== undefined && typeof completeWhen !== "function") {
    throw new TypeError("completeWhen must be a function");
  }

  const detached = process.platform !== "win32";
  let chrome;
  let chromeArgs = [];
  let chromePath = "";
  const cleanupErrors = [];
  let exitCode = null;
  let failure;
  let profileCreated = false;
  let profilePath = "";
  let signal = null;
  let stderrCollector;
  let stdoutCollector;
  let tempDirectory = "";
  const recordCleanupError = (error) => {
    cleanupErrors.push(errorSummary(error));
    failure = failure ?? error;
  };

  try {
    chromePath = await findChrome();
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), "info-chrome-journey-"));
    profilePath = path.join(tempDirectory, "chrome-profile");
    await mkdir(profilePath);
    profileCreated = true;

    const resolvedChromeArgs = typeof requestedChromeArgs === "function"
      ? await requestedChromeArgs({ profilePath, tempDirectory })
      : requestedChromeArgs;
    validateChromeArgs(resolvedChromeArgs);
    chromeArgs = [
      ...(typeof process.getuid === "function" && process.getuid() === 0
        ? ["--no-sandbox"]
        : []),
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--no-first-run",
      `--user-data-dir=${profilePath}`,
      ...resolvedChromeArgs
    ];

    let reportFailure;
    let reportCompletion;
    let completionReported = false;
    let failureReported = false;
    const completionPromise = new Promise((resolve) => {
      reportCompletion = () => {
        if (!completionReported) {
          completionReported = true;
          resolve();
        }
      };
    });
    const failurePromise = new Promise((resolve) => {
      reportFailure = (error) => {
        if (!failureReported) {
          failureReported = true;
          resolve(error);
        }
      };
    });
    stdoutCollector = createBoundedCollector({
      limit: maxStdoutBytes,
      name: "stdout",
      reportFailure
    });
    stderrCollector = createBoundedCollector({
      limit: maxStderrBytes,
      name: "stderr",
      reportFailure
    });

    chrome = spawn(chromePath, chromeArgs, {
      detached,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const closePromise = new Promise((resolve) => {
      chrome.once("close", (code, closeSignal) => {
        resolve({ code, signal: closeSignal });
      });
    });
    chrome.once("error", (error) => {
      reportFailure(
        new ChromeJourneyError(
          `Chrome failed to start: ${error.message}`,
          "CHROME_SPAWN_FAILED",
          { cause: error }
        )
      );
    });
    chrome.stdout.on("data", (chunk) => {
      stdoutCollector.append(chunk);
      if (completeWhen && stdoutCollector.totalBytes <= maxStdoutBytes) {
        try {
          if (completeWhen(stdoutCollector.text)) {
            reportCompletion();
          }
        } catch (error) {
          reportFailure(
            new ChromeJourneyError(
              `Chrome completion check failed: ${error.message}`,
              "CHROME_COMPLETION_FAILED",
              { cause: error }
            )
          );
        }
      }
    });
    chrome.stderr.on("data", (chunk) => stderrCollector.append(chunk));

    const timeout = setTimeout(() => {
      reportFailure(
        new ChromeJourneyError(
          `${name} timed out after ${timeoutMs} ms`,
          "CHROME_TIMEOUT"
        )
      );
    }, timeoutMs);
    const event = await Promise.race([
      closePromise.then((outcome) => ({ outcome, type: "close" })),
      completionPromise.then(() => ({ type: "complete" })),
      failurePromise.then((error) => ({ error, type: "failure" }))
    ]);
    clearTimeout(timeout);

    if (event.type === "complete") {
      try {
        await stopChromeProcess(chrome, detached, terminationGraceMs);
      } catch (error) {
        recordCleanupError(error);
      }
      const outcome = await Promise.race([
        closePromise,
        delay(processKillWaitMs).then(() => null)
      ]);
      if (outcome) {
        exitCode = outcome.code;
        signal = outcome.signal;
      }
    } else if (event.type === "failure") {
      failure = event.error;
      try {
        await stopChromeProcess(chrome, detached, terminationGraceMs);
      } catch (error) {
        recordCleanupError(error);
      }
      const outcome = await Promise.race([
        closePromise,
        delay(processKillWaitMs).then(() => null)
      ]);
      if (outcome) {
        exitCode = outcome.code;
        signal = outcome.signal;
      }
    } else {
      exitCode = event.outcome.code;
      signal = event.outcome.signal;
      if (completeWhen) {
        failure = new ChromeJourneyError(
          `Chrome exited before ${name} reached its completion condition (code=${exitCode}, signal=${signal}).\n${stderrCollector.text}`,
          "CHROME_INCOMPLETE"
        );
      } else if (exitCode !== 0 || signal !== null) {
        failure = new ChromeJourneyError(
          `Chrome exited before ${name} completed (code=${exitCode}, signal=${signal}).\n${stderrCollector.text}`,
          "CHROME_EXIT_FAILED"
        );
      }
    }
  } catch (error) {
    if (failure && failure !== error) {
      cleanupErrors.push(errorSummary(error));
    } else {
      failure = error;
    }
  }

  try {
    await stopChromeProcess(chrome, detached, terminationGraceMs);
  } catch (error) {
    recordCleanupError(error);
  }
  try {
    if (tempDirectory) {
      await rm(tempDirectory, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100
      });
    }
  } catch (error) {
    recordCleanupError(new ChromeJourneyError(
      `Failed to remove Chrome journey directory ${tempDirectory}: ${error.message}`,
      "CHROME_CLEANUP_FAILED",
      { cause: error }
    ));
  }

  const metadata = {
    chromeArgs,
    chromePath,
    cleanupErrors: Object.freeze(cleanupErrors),
    exitCode,
    pid: chrome?.pid,
    profileCreated,
    profilePath,
    signal,
    stderr: stderrCollector?.text ?? "",
    stderrBytes: stderrCollector?.totalBytes ?? 0,
    stderrCapturedBytes: stderrCollector?.capturedBytes ?? 0,
    stdout: stdoutCollector?.text ?? "",
    stdoutBytes: stdoutCollector?.totalBytes ?? 0,
    stdoutCapturedBytes: stdoutCollector?.capturedBytes ?? 0,
    tempDirectory
  };
  if (failure) {
    throw withJourneyMetadata(failure, metadata);
  }
  return Object.freeze(metadata);
}
