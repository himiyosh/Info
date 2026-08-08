import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { chromeJourneyTimeoutMs } from "../helpers/chrome-journey-budget.mjs";

// WCAG 2.1 SC 1.4.12 Text Spacing: a reader may override line height to 1.5,
// paragraph spacing to 2em, letter spacing to 0.12em, and word spacing to
// 0.16em, and no content or functionality may be lost.
//
// The retired print-portfolio module carried this check alongside the print
// contracts, so replacing the page structure took the print portfolio and
// this accessibility guarantee out together. Printing is genuinely gone; the
// reader override is not, and Japanese text with 0.12em tracking is exactly
// the case where a fixed-track layout starts to overflow. This module
// restores the guarantee on its own terms, measured against the composition
// the page actually ships.

const helperUrl = new URL("../helpers/chrome-journey.mjs", import.meta.url);
const repoRoot = process.cwd();
const sentinel = "TEXT-SPACING-MEASURED";
const routes = [
  { language: "ja", outputPath: "index.html" },
  { language: "en", outputPath: "en/index.html" }
];
// 320px is the SC 1.4.10 reflow width; 768px is the breakpoint where the
// panel rows regain their type and stack columns.
const widths = [320, 768];

// Applied inside the page under test, exactly as a reader stylesheet would.
const readerOverride = `
  *, *::before, *::after {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p, li, dd, blockquote, figcaption {
    margin-block-end: 2em !important;
  }
`;

function probeDocument(pageUrls, overrideCss, doneSentinel) {
  const frames = pageUrls
    .map(
      ({ id, url, width, height }) =>
        `<iframe id="${id}" src="${url}" style="width:${width}px;height:${height}px;border:0"></iframe>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>text-spacing probe</title></head>
<body style="margin:0">
${frames}
<pre id="out"></pre>
<script>
const OVERRIDE = ${JSON.stringify(overrideCss)};
const FRAMES = ${JSON.stringify(pageUrls.map(({ id, language, width }) => ({ id, language, width })))};

function measure(win, width) {
  const doc = win.document;
  const style = doc.createElement("style");
  style.textContent = OVERRIDE;
  doc.head.append(style);
  // Force layout after the override lands.
  void doc.documentElement.offsetHeight;

  const body = win.getComputedStyle(doc.body);
  const fontSize = Number.parseFloat(body.fontSize) || 16;
  const round = (value) => Math.round((value / fontSize) * 100) / 100;

  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const computed = win.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      computed.visibility !== "hidden" && computed.display !== "none";
  };

  // Deliberately clipped or off-canvas by design: the visually-hidden
  // pattern, decorative aria-hidden bands such as the marquee, and the
  // tilted hero frame's corner ticks. Excluding them keeps the measurement
  // about content the reader is meant to see.
  const byDesign = (element) =>
    element.closest('.sr-only, [aria-hidden="true"], .skip-link, .hero-marquee, .hero-visual') !== null;

  const cards = [...doc.querySelectorAll("article.card")];
  const rows = [...doc.querySelectorAll(".panel .row")];
  const named = [
    ...cards.map((card) => card.querySelector("h3")),
    ...rows.map((row) => row.querySelector(".name"))
  ];

  // The page root uses overflow-x: clip, so the document can never report
  // horizontal overflow. Content pushed sideways is therefore silently cut
  // off, and the only honest measurement is whether a text-bearing box has
  // left the viewport.
  const offscreen = [...doc.querySelectorAll("main *, footer *")]
    .filter((element) => {
      if (byDesign(element) || !visible(element)) return false;
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent.trim())
        .join("");
      return ownText !== "";
    })
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.left < -1 || rect.right > width + 1)
    .map(({ element, rect }) =>
      (element.className || element.tagName) + "@" + Math.round(rect.right) + "px"
    )
    .slice(0, 8);

  // Below 48rem the navigation collapses behind the toggle, so the links
  // are legitimately hidden; what must survive is a way to reach them.
  const navLinks = [...doc.querySelectorAll('#nav-menu a[href^="#"]')];
  const navReachable = navLinks.every(visible) || visible(doc.querySelector("#hamburger-menu"));
  const alwaysVisible = [
    doc.querySelector(".button-primary"),
    doc.querySelector("#contact-email-link"),
    ...cards.map((card) => card.querySelector("a.link")),
    ...rows.map((row) => row.querySelector("a.row-link"))
  ].filter(Boolean);

  return {
    appliedSpacing: {
      letter: round(Number.parseFloat(body.letterSpacing) || 0),
      line: round(Number.parseFloat(body.lineHeight) || 0),
      word: round(Number.parseFloat(body.wordSpacing) || 0)
    },
    cards: cards.length,
    controls: alwaysVisible.length,
    controlsVisible: alwaysVisible.every(visible),
    namedVisible: named.every((element) => visible(element) && element.textContent.trim() !== ""),
    navReachable,
    offscreen,
    rows: rows.length,
    viewport: width
  };
}

let loaded = 0;
for (const frame of FRAMES) {
  document.getElementById(frame.id).addEventListener("load", () => {
    loaded += 1;
    if (loaded === FRAMES.length) {
      setTimeout(report, 1200);
    }
  });
}

function report() {
  const result = {};
  for (const frame of FRAMES) {
    const key = frame.language + "@" + frame.width;
    try {
      result[key] = measure(document.getElementById(frame.id).contentWindow, frame.width);
    } catch (error) {
      result[key] = { error: String(error && error.message || error) };
    }
  }
  document.getElementById("out").textContent =
    ${JSON.stringify(doneSentinel)} + JSON.stringify(result) + ${JSON.stringify(doneSentinel)};
}
</script>
</body></html>`;
}

function parseMeasurement(stdout) {
  const start = stdout.indexOf(sentinel);
  const end = stdout.indexOf(sentinel, start + sentinel.length);
  assert.ok(start !== -1 && end !== -1, "The probe did not publish a measurement");
  const encoded = stdout.slice(start + sentinel.length, end);
  // --dump-dom serializes the JSON as text nodes, so entities come back escaped.
  const decoded = encoded
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  return JSON.parse(decoded);
}

test("reader text-spacing overrides lose no content at 320px or 768px", async () => {
  const { runChromeJourney } = await import(helperUrl);
  assert.equal(typeof runChromeJourney, "function", "The shared Chrome journey runner must be exported");

  const pageUrls = routes.flatMap(({ language, outputPath }) =>
    widths.map((width) => ({
      height: width === 320 ? 900 : 1024,
      id: `${language}-${width}`,
      language,
      url: pathToFileURL(path.join(repoRoot, outputPath)).href,
      width
    }))
  );

  const probeDirectory = await mkdtemp(path.join(os.tmpdir(), "info-text-spacing-"));
  let measurement;
  try {
    const probePath = path.join(probeDirectory, "text-spacing.html");
    await writeFile(probePath, probeDocument(pageUrls, readerOverride, sentinel), "utf8");
    const journey = await runChromeJourney({
      chromeArgs: [
        "--allow-file-access-from-files",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=12000",
        "--window-size=1200,1200",
        "--dump-dom",
        pathToFileURL(probePath).href
      ],
      completeWhen: (stdout) =>
        stdout.indexOf(sentinel) !== stdout.lastIndexOf(sentinel) && stdout.includes("</html>"),
      name: "text-spacing",
      timeoutMs: chromeJourneyTimeoutMs
    });
    measurement = parseMeasurement(journey.stdout);
  } finally {
    await rm(probeDirectory, { force: true, recursive: true });
  }

  const failures = [];
  for (const { language, width } of pageUrls) {
    const key = `${language}@${width}`;
    const snapshot = measurement[key];
    const expect = (condition, signal) => {
      if (!condition) {
        failures.push(`${key}: ${signal}`);
      }
    };

    if (!snapshot || snapshot.error) {
      failures.push(`${key}: probe failed (${snapshot?.error ?? "no measurement"})`);
      continue;
    }

    // The override must actually be in force, otherwise everything below
    // passes for the wrong reason.
    expect(snapshot.appliedSpacing.letter >= 0.12, `letter spacing ${snapshot.appliedSpacing.letter}em not applied`);
    expect(snapshot.appliedSpacing.word >= 0.16, `word spacing ${snapshot.appliedSpacing.word}em not applied`);
    expect(snapshot.appliedSpacing.line >= 1.5, `line height ${snapshot.appliedSpacing.line} not applied`);

    expect(
      snapshot.offscreen.length === 0,
      `text pushed outside the viewport: ${JSON.stringify(snapshot.offscreen)}`
    );
    expect(snapshot.cards === 3, `featured card count ${snapshot.cards}`);
    expect(snapshot.rows === 6, `panel row count ${snapshot.rows}`);
    expect(snapshot.namedVisible, "a project lost its visible name");
    expect(snapshot.navReachable, "navigation became unreachable at this width");
    expect(snapshot.controlsVisible, "an important control became unreachable");
    expect(snapshot.controls >= 11, `important control count ${snapshot.controls}`);
  }

  assert.deepEqual(failures, [], JSON.stringify(measurement, null, 2));
});
