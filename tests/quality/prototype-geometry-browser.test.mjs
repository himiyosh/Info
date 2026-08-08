import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { runChromeJourney } from "../helpers/chrome-journey.mjs";

// Rendered-geometry contracts for the prototype composition. The string
// contracts elsewhere prove the intended rules exist; these prove which
// rules actually win in the cascade, on the real generated markup with the
// real stylesheets. They exist because a leftover legacy layout rule once
// squeezed About/Projects/Contact into a broken layout while every string
// contract stayed green (PR #88 independent review, finding A).
const repoRoot = process.cwd();
const desktopViewportWidth = 1280;
const desktopViewportHeight = 900;
const maxBrowserOutputBytes = 10 * 1024 * 1024;
const routes = { en: "en/index.html", ja: "index.html" };

const measurementScript = `
    <script>
      const root = document.documentElement;
      const query = (selector) => document.querySelector(selector);
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { h: box.height, l: box.left, r: box.right, w: box.width };
      };
      const tracks = (element) =>
        getComputedStyle(element)
          .gridTemplateColumns.split(" ")
          .filter(Boolean);
      const aboutGrid = query(".about-grid");
      const aboutHeading = query(".about-sticky");
      const aboutCopy = query(".about-copy");
      const sectionHead = query(".section-head");
      const contactPanel = query(".contact-panel");
      const row = query(".panel .row");
      const shell = query(".about.section-shell");
      const metrics = {
        aboutColumns: tracks(aboutGrid),
        aboutCopyBox: rect(aboutCopy),
        aboutGridBox: rect(aboutGrid),
        aboutHeadingBox: rect(aboutHeading),
        aboutStickyPosition: getComputedStyle(aboutHeading).position,
        contactColumns: tracks(contactPanel),
        contactPanelBox: rect(contactPanel),
        desktopBreakpointMatches: matchMedia("(min-width: 60rem)").matches,
        document: {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth
        },
        rowColumns: tracks(row),
        sectionHeadBox: rect(sectionHead),
        shellPaddingInline: [
          getComputedStyle(shell).paddingLeft,
          getComputedStyle(shell).paddingRight
        ],
        viewportWidth: innerWidth
      };
      document
        .querySelector('meta[name="geometry"]')
        .setAttribute("content", btoa(JSON.stringify(metrics)));
      root.dataset.geometryReady = "true";
    </script>`;

// Headless Chrome clamps its window to 500px wide, so narrow-reflow
// measurements run inside a same-origin iframe sized to the target width.
// The framed page measures itself and posts the numbers up; the wrapper
// publishes them for --dump-dom.
const overflowScript = `
    <script>
      const root = document.documentElement;
      parent.postMessage(
        {
          document: {
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth
          },
          viewportWidth: innerWidth
        },
        "*"
      );
    </script>`;

function wrapperHtml(width, height) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="geometry" content="">
  </head>
  <body>
    <script>
      addEventListener("message", (event) => {
        document
          .querySelector('meta[name="geometry"]')
          .setAttribute("content", btoa(JSON.stringify(event.data)));
        document.documentElement.dataset.geometryReady = "true";
      });
    </script>
    <iframe src="fixture.html" style="width: ${width}px; height: ${height}px; border: 0"></iframe>
  </body>
</html>`;
}

// WCAG 1.4.12 text-spacing overrides. Content must survive them with no
// horizontal overflow. This restores the retired print-portfolio spacing
// contract in a non-print form.
const textSpacingStyle = `
    <style>
      * {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p {
        margin-block-end: 2em !important;
      }
    </style>`;

async function buildFixture({ language, spacing }) {
  const pageSource = await readFile(
    path.join(repoRoot, routes[language]),
    "utf8"
  );
  const baseHref = pathToFileURL(
    `${path.join(repoRoot, path.dirname(routes[language]))}${path.sep}`
  ).href;
  const withoutScripts = pageSource.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/g,
    ""
  );
  assert.ok(
    !withoutScripts.includes("<script"),
    "The fixture must strip every page script so the static resting layout is measured"
  );
  const withBase = withoutScripts.replace(
    /<head>/,
    `<head><base href="${baseHref}"><meta name="geometry" content="">${spacing ? textSpacingStyle : ""}`
  );
  assert.notEqual(withBase, withoutScripts, "The fixture must anchor relative URLs");
  return withBase.replace(
    "</body>",
    `${spacing ? overflowScript : measurementScript}\n  </body>`
  );
}

async function renderFixture({ height, language, spacing, width }) {
  const { stdout } = await runChromeJourney({
    chromeArgs: async ({ tempDirectory }) => {
      const fixturePath = path.join(tempDirectory, "fixture.html");
      await writeFile(
        fixturePath,
        await buildFixture({ language, spacing }),
        "utf8"
      );
      let entryPath = fixturePath;
      if (spacing) {
        entryPath = path.join(tempDirectory, "wrapper.html");
        await writeFile(entryPath, wrapperHtml(width, height), "utf8");
      }
      return [
        "--force-device-scale-factor=1",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=5000",
        `--window-size=${Math.max(width, 500)},${height}`,
        "--allow-file-access-from-files",
        "--dump-dom",
        pathToFileURL(entryPath).href
      ];
    },
    completeWhen: (partial) =>
      /<html\b[^>]*\bdata-geometry-ready="true"/.test(partial) &&
      partial.includes("</html>"),
    maxStdoutBytes: maxBrowserOutputBytes,
    name: `prototype-geometry-${language}-${width}`,
    timeoutMs: 20_000
  });
  const encodedGeometry = stdout.match(
    /<meta name="geometry" content="([^"]+)">/
  )?.[1];
  assert.ok(encodedGeometry, "Chrome did not return encoded geometry");
  return JSON.parse(Buffer.from(encodedGeometry, "base64").toString("utf8"));
}

test("geometry fixtures publish their completion signal synchronously", async () => {
  for (const spacing of [false, true]) {
    const source = await buildFixture({ language: "ja", spacing });
    assert.doesNotMatch(
      source,
      /addEventListener\("load"|document\.fonts\.ready|requestAnimationFrame/,
      "Geometry readiness must not wait behind asynchronous browser lifecycle work"
    );
  }
  const geometrySource = await buildFixture({ language: "ja", spacing: false });
  const markerIndex = geometrySource.indexOf(
    'root.dataset.geometryReady = "true"'
  );
  assert.ok(markerIndex >= 0, "The fixture must contain a completion marker");
  assert.ok(
    geometrySource.lastIndexOf("</script>") > markerIndex,
    "The fixture must publish the marker before parsing completes"
  );
  const spacingSource = await buildFixture({ language: "ja", spacing: true });
  assert.ok(
    spacingSource.includes("parent.postMessage"),
    "The framed spacing fixture must post its metrics synchronously at parse time"
  );
  const wrapperSource = wrapperHtml(320, 900);
  assert.ok(
    wrapperSource.indexOf('addEventListener("message"') <
      wrapperSource.indexOf("<iframe"),
    "The wrapper must listen before the framed page can post"
  );
});

for (const language of ["ja", "en"]) {
  test(`the ${language} desktop page renders the prototype composition, not the retired scene layout`, async () => {
    const geometry = await renderFixture({
      height: desktopViewportHeight,
      language,
      spacing: false,
      width: desktopViewportWidth
    });
    const describe = () => JSON.stringify(geometry, null, 2);

    assert.equal(geometry.desktopBreakpointMatches, true, describe());
    assert.equal(geometry.viewportWidth, desktopViewportWidth, describe());
    assert.ok(
      geometry.document.scrollWidth <= geometry.document.clientWidth,
      `The page must not overflow horizontally: ${describe()}`
    );

    // About: two near-equal columns, sticky heading beside the copy.
    assert.equal(geometry.aboutColumns.length, 2, describe());
    const [firstTrack, secondTrack] = geometry.aboutColumns.map(Number.parseFloat);
    assert.ok(
      Math.abs(firstTrack - secondTrack) <= 1,
      `About columns must split evenly: ${describe()}`
    );
    assert.ok(
      firstTrack >= geometry.aboutGridBox.w * 0.4,
      `The About heading column must not collapse: ${describe()}`
    );
    assert.equal(geometry.aboutStickyPosition, "sticky", describe());
    assert.ok(
      geometry.aboutHeadingBox.r <= geometry.aboutCopyBox.l + 1,
      `The About heading must sit beside the copy, not over it: ${describe()}`
    );

    // The shell is the prototype's container: width does the guttering,
    // never an inline padding that narrows every section.
    assert.deepEqual(geometry.shellPaddingInline, ["0px", "0px"], describe());
    assert.ok(
      geometry.aboutGridBox.w >= 1100,
      `The shell must span min(1160px, 92vw): ${describe()}`
    );

    // Projects: the section head is one compact band, not a scene chapter.
    assert.ok(
      geometry.sectionHeadBox.h <= 400,
      `The Projects head must stay a compact band: ${describe()}`
    );

    // Panel rows keep the five-column desktop grid.
    assert.equal(geometry.rowColumns.length, 5, describe());

    // Contact: one centred column.
    assert.equal(geometry.contactColumns.length, 1, describe());
    const leftGap = geometry.contactPanelBox.l;
    const rightGap = geometry.viewportWidth - geometry.contactPanelBox.r;
    assert.ok(
      Math.abs(leftGap - rightGap) <= 2,
      `The contact panel must stay centred: ${describe()}`
    );
  });
}

for (const width of [320, 768]) {
  test(`the ja page survives WCAG 1.4.12 text spacing at ${width}px with no horizontal overflow`, async () => {
    const geometry = await renderFixture({
      height: desktopViewportHeight,
      language: "ja",
      spacing: true,
      width
    });
    assert.equal(geometry.viewportWidth, width, JSON.stringify(geometry));
    assert.ok(
      geometry.document.scrollWidth <= geometry.document.clientWidth,
      `Text spacing must not force horizontal overflow at ${width}px: ${JSON.stringify(geometry)}`
    );
  });
}
