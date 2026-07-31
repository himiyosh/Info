import assert from "node:assert/strict";

export const qualitySpawnTimeoutEnvironmentName =
  "INFO_QUALITY_SPAWN_TIMEOUT_MS";
export const defaultQualitySpawnTimeoutMs = 300_000;

const positiveIntegerPattern = /^[1-9][0-9]*$/;

export function resolveQualitySpawnTimeoutMs(rawValue) {
  if (rawValue === undefined) {
    return defaultQualitySpawnTimeoutMs;
  }
  const parsed =
    typeof rawValue === "string" && positiveIntegerPattern.test(rawValue)
      ? Number(rawValue)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(
      `${qualitySpawnTimeoutEnvironmentName} must be a positive safe integer count of milliseconds; received ${JSON.stringify(rawValue)}`
    );
  }
  return parsed;
}

export const qualitySpawnTimeoutMs = resolveQualitySpawnTimeoutMs(
  process.env[qualitySpawnTimeoutEnvironmentName]
);

export function assertQualitySpawnCompleted(result, label) {
  const spawnError = result.error;
  if (spawnError === undefined || spawnError === null) {
    return;
  }
  if (spawnError.code === "ETIMEDOUT") {
    throw new Error(
      [
        `Nested quality-suite run for ${label} was killed after the ${qualitySpawnTimeoutMs} ms spawn budget elapsed.`,
        "This is a spawn timeout, not a failing contract assertion.",
        `Raise ${qualitySpawnTimeoutEnvironmentName} (default ${defaultQualitySpawnTimeoutMs} ms) for a slower runner, or shrink the nested suite.`
      ].join(" "),
      { cause: spawnError }
    );
  }
  assert.ifError(spawnError);
}
