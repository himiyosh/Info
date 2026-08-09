import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { runChromeJourney } from "../helpers/chrome-journey.mjs";
import { chromeJourneyTimeoutMs } from "../helpers/chrome-journey-budget.mjs";

// The page still ships a print stylesheet — four `@media print` blocks and
// 167 declarations, rewritten for the prototype composition. What it stopped
// shipping, when the scene-era print contract was deleted with the structure
// it described, was any check that the sheet still prints the portfolio.
//
// Rendering under print media needs CDP, which this dependency-free suite
// does not use. Promoting `@media print` to `@media all` in a fixture copy
// applies exactly those declarations — they stay last in each file, so they
// still win — and lets the real browser answer the only question that
// matters: with the print rules in force, is the content still there?
const repoRoot = process.cwd();
// A4 at 96dpi less the 12mm @page margin on each side.
const printWidth = 704;
const printHeight = 1123;
const routes = { en: "en/index.html", ja: "index.html" };
const stylesheets = ["tokens.css", "styles.css", "modern.css"];

// Declared `display: none` by the print blocks. Screen chrome and decoration
// must not reach paper; if one of these reappears the sheet regressed.
//
// Only selectors that are *visible without the print rules* belong here, and
// each of these six was measured to be. `.menu-toggle` and `.theme-toggle`
// are deliberately absent: the fixture strips scripts, so `.js-enabled` is
// never set and both stay hidden whatever the print sheet says. Asserting
// them would add a line that cannot fail.
const mustNotPrint = [
  ".footer-clock",
  ".hero-marquee",
  ".nav-menu",
  ".scroll-cue",
  ".scroll-progress",
  ".site-backdrop"
];

const measurementScript = `
    <script>
      const q = (selector) => document.querySelector(selector);
      const all = (selector) => [...document.querySelectorAll(selector)];
      const visible = (element) => {
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        return box.width > 0 && box.height > 0 &&
          computed.visibility !== "hidden" && computed.display !== "none";
      };
      // Own text only: the .sr-only spans carry sentences that lay out far
      // past their 1px box, and counting them reports loss where there is none.
      const ownInk = (element) => {
        let union = null;
        for (const node of element.childNodes) {
          if (node.nodeType !== 3 || node.textContent.trim() === "") continue;
          const range = document.createRange();
          range.selectNode(node);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          union = union
            ? { bottom: Math.max(union.bottom, rect.bottom), left: Math.min(union.left, rect.left),
                right: Math.max(union.right, rect.right), top: Math.min(union.top, rect.top) }
            : { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
        }
        return union;
      };
      const clipperOf = (element) => {
        for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
          const computed = getComputedStyle(node);
          if (computed.overflowX !== "visible" || computed.overflowY !== "visible") return node;
        }
        return null;
      };
      const named = [
        ...all("article.card h3"),
        ...all(".panel .row .name")
      ];
      const clipped = named
        .filter(visible)
        .map((element) => {
          const ink = ownInk(element);
          if (!ink) return { label: "", lost: 0 };
          const box = clipperOf(element);
          const bounds = box
            ? box.getBoundingClientRect()
            : { bottom: Infinity, left: 0, right: innerWidth, top: -Infinity };
          return {
            label: element.textContent.trim().slice(0, 24),
            lost: Math.round(Math.max(
              ink.right - bounds.right, bounds.left - ink.left,
              ink.bottom - bounds.bottom, bounds.top - ink.top
            ))
          };
        })
        .filter((entry) => entry.lost > 1);
      const metrics = {
        animated: all("*").filter((element) => {
          const computed = getComputedStyle(element);
          return computed.animationName !== "none" && computed.animationDuration !== "0s";
        }).length,
        clipped,
        contactHrefs: all('a[href^="mailto:"], a[href^="https://github.com/himiyosh"]')
          .filter(visible).map((element) => element.getAttribute("href")),
        disclaimerVisible: visible(q(".footer-disclaimer")),
        leaked: ${JSON.stringify(mustNotPrint)}.filter((selector) =>
          all(selector).some(visible)),
        names: named.map((element) => ({
          text: element.textContent.trim(),
          visible: visible(element)
        }))
      };
      document.querySelector('meta[name="printcheck"]').setAttribute("content", btoa(unescape(encodeURIComponent(JSON.stringify(metrics)))));
      document.documentElement.dataset.printReady = "true";
    </script>`;

// Promote every print block so the browser applies it. The blocks sit last in
// each file, so promoting them preserves the cascade order they rely on.
function promotePrintRules(source) {
  return source.replaceAll("@media print", "@media all");
}

async function buildFixture(language) {
  const outputPath = routes[language];
  const page = await readFile(path.join(repoRoot, outputPath), "utf8");
  const directory = path.join(repoRoot, path.dirname(outputPath));
  const baseHref = pathToFileURL(`${directory}${path.sep}`).href;

  const sheets = await Promise.all(
    stylesheets.map(async (name) => promotePrintRules(await readFile(path.join(repoRoot, name), "utf8")))
  );
  assert.ok(
    sheets.some((sheet) => sheet.includes("@media all")),
    "The fixture must promote at least one print block, otherwise it measures the screen sheet"
  );

  const withoutScripts = page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const withoutLinks = stylesheets.reduce(
    (html, name) => html.replace(new RegExp(`\\s*<link rel="stylesheet" href="${name}"\\s*/?>`), ""),
    withoutScripts
  );
  for (const name of stylesheets) {
    assert.ok(
      !withoutLinks.includes(`href="${name}"`),
      `The fixture must replace the ${name} link with its promoted copy`
    );
  }

  const head = `<head><base href="${baseHref}"><meta name="printcheck" content="">` +
    `<style>${sheets.join("\n")}</style>`;
  return withoutLinks
    .replace(/<head>/, head)
    .replace("</body>", `${measurementScript}\n  </body>`);
}

async function renderPrint(language) {
  const { stdout } = await runChromeJourney({
    chromeArgs: async ({ tempDirectory }) => {
      const fixturePath = path.join(tempDirectory, `print-${language}.html`);
      await writeFile(fixturePath, await buildFixture(language), "utf8");
      return [
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=6000",
        `--window-size=${printWidth},${printHeight}`,
        "--dump-dom",
        pathToFileURL(fixturePath).href
      ];
    },
    completeWhen: (partial) =>
      /<html\b[^>]*\bdata-print-ready="true"/.test(partial) && partial.includes("</html>"),
    maxStdoutBytes: 10 * 1024 * 1024,
    name: `print-${language}`,
    timeoutMs: chromeJourneyTimeoutMs
  });
  const encoded = stdout.match(/<meta name="printcheck" content="([^"]+)">/)?.[1];
  assert.ok(encoded, "Chrome did not return the print measurement");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

for (const language of ["ja", "en"]) {
  test(`the ${language} page still prints the whole portfolio`, async () => {
    const projects = JSON.parse(await readFile(path.join(repoRoot, "projects.json"), "utf8"));
    const printed = await renderPrint(language);
    const describe = () => JSON.stringify(printed, null, 2);

    // Every project reaches paper, named, in projects.json order.
    assert.equal(printed.names.length, projects.length, describe());
    printed.names.forEach((entry, index) => {
      assert.equal(entry.text, projects[index].title[language], describe());
      assert.ok(entry.visible, `${entry.text} must print: ${describe()}`);
    });

    // ...and nothing is cut off on the way.
    assert.deepEqual(printed.clipped, [], describe());

    // The reader keeps a way to make contact, and the disclaimer travels.
    assert.ok(printed.contactHrefs.length >= 1, `A contact path must print: ${describe()}`);
    assert.ok(printed.disclaimerVisible, describe());

    // Screen chrome and decoration stay off paper, and nothing animates.
    assert.deepEqual(printed.leaked, [], describe());
    assert.equal(printed.animated, 0, describe());
  });
}
