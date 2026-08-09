export const chromeJourneyTimeoutEnvironmentName =
  "INFO_CHROME_JOURNEY_TIMEOUT_MS";

// Page journeys share one budget instead of carrying per-file numbers, for
// the same reason the nested spawns do: the structure guards re-run the whole
// quality directory as child processes, so several Chrome instances start at
// once on a two-core CI runner. A 20-second budget that is generous on an
// idle laptop is not generous under that storm — it timed out in CI while the
// same test passed locally five times in a row.
export const defaultChromeJourneyTimeoutMs = 60_000;

const positiveIntegerPattern = /^[1-9][0-9]*$/;

export function resolveChromeJourneyTimeoutMs(rawValue) {
  if (rawValue === undefined) {
    return defaultChromeJourneyTimeoutMs;
  }
  const parsed =
    typeof rawValue === "string" && positiveIntegerPattern.test(rawValue)
      ? Number(rawValue)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(
      `${chromeJourneyTimeoutEnvironmentName} must be a positive safe integer count of milliseconds; received ${JSON.stringify(rawValue)}`
    );
  }
  return parsed;
}

export const chromeJourneyTimeoutMs = resolveChromeJourneyTimeoutMs(
  process.env[chromeJourneyTimeoutEnvironmentName]
);
