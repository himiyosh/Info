import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const helperUrl = new URL("../helpers/chrome-journey.mjs", import.meta.url);
const repoRoot = process.cwd();
const blockedNetworkArgument = "--host-resolver-rules=MAP * ~NOTFOUND";
const routes = {
  ja: {
    alternateTitle: "Technology,",
    outputPath: "index.html",
    route: "/",
    titleLine1: "技術を、",
    titleLine2: "役に立つ形へ。"
  },
  en: {
    alternateTitle: "技術を、",
    outputPath: "en/index.html",
    route: "/en/",
    titleLine1: "Technology,",
    titleLine2: "made useful."
  }
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function renderGeneratedRoute(language) {
  const { runChromeJourney } = await import(helperUrl);
  assert.equal(
    typeof runChromeJourney,
    "function",
    "The shared Chrome journey runner must be exported"
  );
  const route = routes[language];
  const pageUrl = pathToFileURL(path.join(repoRoot, route.outputPath));
  const result = await runChromeJourney({
    chromeArgs: [
      "--allow-file-access-from-files",
      blockedNetworkArgument,
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=5000",
      "--window-size=1200,900",
      "--dump-dom",
      pageUrl.href
    ],
    completeWhen: (stdout) =>
      stdout.includes(`lang="${language}"`) &&
      stdout.includes(route.titleLine1) &&
      stdout.includes(route.titleLine2) &&
      stdout.includes("</html>"),
    name: `generated-${language}`,
    timeoutMs: 20_000
  });
  return { language, pageUrl, result, route };
}

function assertLocalizedRender({ language, pageUrl, result, route }) {
  const context = `${language} ${route.route}`;
  assert.ok(
    result.chromeArgs.includes(blockedNetworkArgument),
    `${context} did not run with host networking blocked`
  );
  assert.ok(
    result.chromeArgs.includes(pageUrl.href),
    `${context} did not render its generated file`
  );
  assert.match(
    result.stdout,
    new RegExp(`<html\\b[^>]*\\blang="${language}"(?:\\s|>)`),
    `${context} rendered the wrong document locale`
  );
  assert.match(
    result.stdout,
    /<html\b[^>]*\bclass="[^"]*\bjs-enabled\b[^"]*"/,
    `${context} did not execute the generated page bootstrap`
  );
  assert.match(
    result.stdout,
    new RegExp(
      `data-i18n="hero\\.titleLine1"[^>]*>\\s*${escapeRegExp(route.titleLine1)}\\s*<`
    ),
    `${context} did not render its primary localized hero line`
  );
  assert.match(
    result.stdout,
    new RegExp(
      `data-i18n="hero\\.titleLine2"[^>]*>\\s*${escapeRegExp(route.titleLine2)}\\s*<`
    ),
    `${context} did not render its secondary localized hero line`
  );
  assert.doesNotMatch(
    result.stdout,
    new RegExp(
      `data-i18n="hero\\.titleLine1"[^>]*>\\s*${escapeRegExp(route.alternateTitle)}\\s*<`
    ),
    `${context} rendered the other locale's hero copy`
  );
  assert.match(
    result.stdout,
    /<div\b[^>]*\bid="projects-fallback"[^>]*>/,
    `${context} lost its network-independent project fallback`
  );
}

test("JA / and EN /en/ generated pages render non-empty localized DOM without network access", async () => {
  const ja = await renderGeneratedRoute("ja");
  assert.ok(ja.result.stdout.trim().length > 0, "JA / returned an empty Chrome DOM");

  const en = await renderGeneratedRoute("en");
  assert.ok(en.result.stdout.trim().length > 0, "EN /en/ returned an empty Chrome DOM");
  const renderedRoutes = [ja, en];
  assert.notEqual(
    ja.result.stdout,
    en.result.stdout,
    "JA / and EN /en/ must not collapse to the same non-empty rendered DOM"
  );
  for (const rendered of renderedRoutes) {
    assertLocalizedRender(rendered);
  }
});
