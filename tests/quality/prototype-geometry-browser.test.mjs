import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { runChromeJourney } from "../helpers/chrome-journey.mjs";

// Rendered-geometry contracts for the prototype composition.
// WCAG 1.4.12 text-spacing resilience is NOT measured here: with
// `html { overflow-x: clip }` in styles.css, documentElement.scrollWidth can
// never exceed clientWidth, so any overflow assertion built on that pair is
// incapable of failing (proved with a 520px negative control). That contract
// lives in tests/quality/text-spacing-resilience.test.mjs, which measures
// text Ranges instead and does detect the same control. The string
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

async function buildFixture(language) {
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
    `<head><base href="${baseHref}"><meta name="geometry" content="">`
  );
  assert.notEqual(withBase, withoutScripts, "The fixture must anchor relative URLs");
  return withBase.replace("</body>", `${measurementScript}\n  </body>`);
}

async function renderFixture({ height, language, width }) {
  const { stdout } = await runChromeJourney({
    chromeArgs: async ({ tempDirectory }) => {
      const fixturePath = path.join(tempDirectory, "fixture.html");
      await writeFile(fixturePath, await buildFixture(language), "utf8");
      return [
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=5000",
        `--window-size=${width},${height}`,
        "--allow-file-access-from-files",
        "--dump-dom",
        pathToFileURL(fixturePath).href
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

test("the geometry fixture publishes its completion signal synchronously", async () => {
  const source = await buildFixture("ja");
  assert.doesNotMatch(
    source,
    /addEventListener\("load"|document\.fonts\.ready|requestAnimationFrame/,
    "Geometry readiness must not wait behind asynchronous browser lifecycle work"
  );
  const markerIndex = source.indexOf('root.dataset.geometryReady = "true"');
  assert.ok(markerIndex >= 0, "The fixture must contain a completion marker");
  assert.ok(
    source.lastIndexOf("</script>") > markerIndex,
    "The fixture must publish the marker before parsing completes"
  );
});

for (const language of ["ja", "en"]) {
  test(`the ${language} desktop page renders the prototype composition, not the retired scene layout`, async () => {
    const geometry = await renderFixture({
      height: desktopViewportHeight,
      language,
      width: desktopViewportWidth
    });
    const describe = () => JSON.stringify(geometry, null, 2);

    assert.equal(geometry.desktopBreakpointMatches, true, describe());
    assert.equal(geometry.viewportWidth, desktopViewportWidth, describe());

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

    // Contact: one centred column. Centre against the layout viewport
    // (clientWidth) — innerWidth includes the classic scrollbar on Linux
    // runners, which skews the right-hand gap by the scrollbar width.
    assert.equal(geometry.contactColumns.length, 1, describe());
    const leftGap = geometry.contactPanelBox.l;
    const rightGap = geometry.document.clientWidth - geometry.contactPanelBox.r;
    assert.ok(
      Math.abs(leftGap - rightGap) <= 2,
      `The contact panel must stay centred: ${describe()}`
    );
  });
}
