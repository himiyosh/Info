import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const helperUrl = new URL("../helpers/chrome-journey.mjs", import.meta.url);
const maxStdoutBytes = 64 * 1024;
const timeoutMs = 300;

async function loadJourneyHelper() {
  const helper = await import(helperUrl);
  assert.equal(
    typeof helper.runChromeJourney,
    "function",
    "The shared Chrome journey runner must be exported"
  );
  return helper.runChromeJourney;
}

function assertProcessGroupStopped(pid, context) {
  assert.ok(Number.isInteger(pid) && pid > 0, `${context}: Chrome PID was not captured`);
  const signalTarget = process.platform === "win32" ? pid : -pid;
  assert.throws(
    () => process.kill(signalTarget, 0),
    (error) => error?.code === "ESRCH",
    `${context}: Chrome process group ${signalTarget} is still running`
  );
}

async function assertPathRemoved(targetPath, context) {
  assert.ok(
    typeof targetPath === "string" && path.isAbsolute(targetPath),
    `${context}: cleanup path was not captured`
  );
  await assert.rejects(
    access(targetPath),
    (error) => error?.code === "ENOENT",
    `${context}: ${targetPath} still exists`
  );
}

async function assertJourneyCleaned(metadata, context) {
  assert.ok(metadata && typeof metadata === "object", `${context}: metadata is missing`);
  assert.equal(metadata.profileCreated, true, `${context}: profile setup did not complete`);
  assert.ok(
    typeof metadata.tempDirectory === "string" &&
      path.isAbsolute(metadata.tempDirectory),
    `${context}: temporary directory was not captured`
  );
  assert.ok(
    typeof metadata.profilePath === "string" &&
      path.isAbsolute(metadata.profilePath),
    `${context}: profile path was not captured`
  );
  assert.equal(
    path.dirname(metadata.profilePath),
    metadata.tempDirectory,
    `${context}: profile escaped its journey directory`
  );
  assertProcessGroupStopped(metadata.pid, context);
  await assertPathRemoved(metadata.profilePath, `${context} profile`);
  await assertPathRemoved(metadata.tempDirectory, `${context} directory`);
}

test("successful and timed-out Chrome journeys use unique profiles and clean every process", async () => {
  const runChromeJourney = await loadJourneyHelper();
  const marker = "px-browser-001-success";
  const successful = await runChromeJourney({
    chromeArgs: [
      "--dump-dom",
      `data:text/html,${encodeURIComponent(`<main id="${marker}">ready</main>`)}`
    ],
    completeWhen: (stdout) =>
      stdout.includes(`id="${marker}"`) && stdout.includes("</html>"),
    maxStdoutBytes,
    name: "cleanup-success",
    timeoutMs: 10_000
  });

  assert.match(successful.stdout, new RegExp(`id="${marker}"`));
  assert.ok(successful.stdoutBytes > 0, "Successful Chrome output must be measured");
  assert.ok(
    successful.stdoutBytes <= maxStdoutBytes,
    "Successful Chrome output exceeded its configured bound"
  );
  await assertJourneyCleaned(successful, "successful journey");

  let timedOut;
  try {
    await runChromeJourney({
      chromeArgs: ["--remote-debugging-port=0", "about:blank"],
      name: "cleanup-timeout",
      timeoutMs
    });
  } catch (error) {
    timedOut = error;
  }

  assert.ok(timedOut instanceof Error, "The non-terminating journey must fail");
  assert.equal(timedOut.code, "CHROME_TIMEOUT");
  assert.match(timedOut.message, new RegExp(`timed out after ${timeoutMs} ms`));
  await assertJourneyCleaned(timedOut.chromeJourney, "timed-out journey");
  assert.notEqual(
    successful.profilePath,
    timedOut.chromeJourney.profilePath,
    "Each Chrome journey must receive a unique profile"
  );
  assert.notEqual(
    successful.tempDirectory,
    timedOut.chromeJourney.tempDirectory,
    "Each Chrome journey must receive a unique temporary directory"
  );
});
