import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { runChromeJourney } from "../helpers/chrome-journey.mjs";

const repoRoot = process.cwd();
const desktopViewportWidth = 1200;
const longLocalizedTitle =
  "国際化された非常に長いプロジェクトタイトル".repeat(24);
const maxBrowserOutputBytes = 10 * 1024 * 1024;

function directoryItems() {
  const titles = [
    longLocalizedTitle,
    "技術ダッシュボード",
    "AI エージェント",
    "Git 支援ツール",
    "フィットネス",
    "エンコード・デコード",
    "ネットワーク拡張",
    "URL デコーダー",
    "画像リサイザー"
  ];

  return titles
    .map(
      (title, index) => `
        <li>
          <a class="project-directory-link" href="#project-${index + 1}">
            <span class="project-directory-title">${title}</span>
            <span class="project-directory-kind">公開プロジェクト</span>
          </a>
        </li>`
    )
    .join("");
}

function fixtureHtml() {
  const stylesheet = (fileName) =>
    pathToFileURL(path.join(repoRoot, fileName)).href;

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="geometry" content="">
    <link rel="stylesheet" href="${stylesheet("tokens.css")}">
    <link rel="stylesheet" href="${stylesheet("styles.css")}">
    <link rel="stylesheet" href="${stylesheet("modern.css")}">
  </head>
  <body>
    <main>
      <section class="projects" id="projects">
        <div class="section-shell">
          <div class="projects-intro">
            <h2>プロジェクト</h2>
            <p>公開プロジェクトの一覧です。</p>
            <nav class="project-directory" aria-label="プロジェクト一覧">
              <ul class="project-directory-list">${directoryItems()}</ul>
            </nav>
          </div>
        </div>
      </section>
    </main>
    <script>
      const root = document.documentElement;
      const directory = document.querySelector(".project-directory");
      const list = document.querySelector(".project-directory-list");
      const item = list.querySelector("li");
      const title = item.querySelector(".project-directory-title");
      const titleStyle = getComputedStyle(title);
      const listStyle = getComputedStyle(list);
      const titleRect = title.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const directoryRect = directory.getBoundingClientRect();
      const metrics = {
        breakpointMatches: matchMedia("(min-width: 67rem)").matches,
        viewportWidth: innerWidth,
        columns: listStyle.gridTemplateColumns.split(" ").filter(Boolean),
        document: {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth
        },
        directory: {
          clientWidth: directory.clientWidth,
          scrollWidth: directory.scrollWidth,
          left: directoryRect.left,
          right: directoryRect.right
        },
        list: {
          clientWidth: list.clientWidth,
          scrollWidth: list.scrollWidth,
          left: listRect.left,
          right: listRect.right
        },
        item: {
          left: itemRect.left,
          right: itemRect.right
        },
        title: {
          clientWidth: title.clientWidth,
          scrollWidth: title.scrollWidth,
          left: titleRect.left,
          right: titleRect.right,
          overflowX: titleStyle.overflowX,
          textOverflow: titleStyle.textOverflow,
          whiteSpace: titleStyle.whiteSpace
        }
      };

      document
        .querySelector('meta[name="geometry"]')
        .setAttribute("content", btoa(JSON.stringify(metrics)));
      root.dataset.geometryReady = "true";
    </script>
  </body>
</html>`;
}

test("directory geometry publishes its completion signal before Chrome can dump and exit", () => {
  const source = fixtureHtml();
  assert.doesNotMatch(
    source,
    /addEventListener\("load"|document\.fonts\.ready|requestAnimationFrame/,
    "Geometry readiness must not wait behind asynchronous browser lifecycle work"
  );
  const markerIndex = source.indexOf('root.dataset.geometryReady = "true"');
  const scriptEndIndex = source.lastIndexOf("</script>");
  assert.ok(
    markerIndex >= 0,
    "The fixture must contain an explicit geometry completion marker"
  );
  assert.ok(
    scriptEndIndex > markerIndex,
    "The fixture must publish a synchronous geometry marker before parsing completes"
  );
});

async function renderGeometry() {
  const { stdout } = await runChromeJourney({
    chromeArgs: async ({ tempDirectory }) => {
      const fixturePath = path.join(tempDirectory, "fixture.html");
      await writeFile(fixturePath, fixtureHtml(), "utf8");
      return [
        "--force-device-scale-factor=1",
        "--run-all-compositor-stages-before-draw",
        `--window-size=${desktopViewportWidth},900`,
        "--allow-file-access-from-files",
        "--dump-dom",
        pathToFileURL(fixturePath).href
      ];
    },
    completeWhen: (stdout) =>
      /<html\b[^>]*\bdata-geometry-ready="true"/.test(stdout) &&
      stdout.includes("</html>"),
    maxStdoutBytes: maxBrowserOutputBytes,
    name: "project-directory-1200px",
    timeoutMs: 20_000
  });
  assert.match(
    stdout,
    /<html\b[^>]*\bdata-geometry-ready="true"/,
    "Chrome did not finish the geometry measurement"
  );
  const encodedGeometry = stdout.match(
    /<meta name="geometry" content="([^"]+)">/
  )?.[1];
  assert.ok(encodedGeometry, "Chrome did not return encoded geometry");
  return JSON.parse(Buffer.from(encodedGeometry, "base64").toString("utf8"));
}

test("long localized directory titles stay inside the three-column desktop layout", async () => {
  const geometry = await renderGeometry();
  const describe = () => JSON.stringify(geometry, null, 2);

  assert.equal(geometry.breakpointMatches, true, describe());
  assert.equal(geometry.viewportWidth, desktopViewportWidth, describe());
  assert.equal(geometry.columns.length, 3, describe());
  assert.ok(
    geometry.document.scrollWidth <= geometry.document.clientWidth,
    describe()
  );
  assert.ok(
    geometry.directory.scrollWidth <= geometry.directory.clientWidth,
    describe()
  );
  assert.ok(geometry.list.scrollWidth <= geometry.list.clientWidth, describe());
  assert.ok(geometry.item.left >= geometry.list.left, describe());
  assert.ok(geometry.item.right <= geometry.list.right, describe());
  assert.ok(geometry.title.left >= geometry.item.left, describe());
  assert.ok(geometry.title.right <= geometry.item.right, describe());
  assert.ok(geometry.title.clientWidth < geometry.title.scrollWidth, describe());
  assert.equal(geometry.title.overflowX, "hidden", describe());
  assert.equal(geometry.title.textOverflow, "ellipsis", describe());
  assert.equal(geometry.title.whiteSpace, "nowrap", describe());
});
