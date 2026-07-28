import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const repoRoot = process.cwd();
const desktopViewportWidth = 1200;
const longLocalizedTitle =
  "国際化された非常に長いプロジェクトタイトル".repeat(24);
const maxBrowserOutputBytes = 10 * 1024 * 1024;

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
      await access(candidate);
      return candidate;
    } catch {
      // Keep looking for the first installed browser.
    }
  }

  assert.fail(
    `Chrome was not found. Set CHROME_PATH or install it at one of: ${candidates.join(", ")}`
  );
}

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
      addEventListener("load", async () => {
        await document.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

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
      });
    </script>
  </body>
</html>`;
}

function dumpDom(chromePath, args) {
  return new Promise((resolve, reject) => {
    const chrome = spawn(chromePath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let failure = null;
    let geometryReady = false;
    let forceKillTimer = null;
    const stopChrome = (signal) => {
      if (chrome.exitCode === null && chrome.signalCode === null) {
        chrome.kill(signal);
      }
    };
    const timeout = setTimeout(() => {
      failure = new Error("Chrome timed out while rendering directory geometry");
      stopChrome("SIGKILL");
    }, 20_000);

    chrome.stdout.setEncoding("utf8");
    chrome.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > maxBrowserOutputBytes) {
        failure = new Error("Chrome DOM output exceeded the 10 MiB safety limit");
        stopChrome("SIGKILL");
        return;
      }

      if (
        !geometryReady &&
        /<html\b[^>]*\bdata-geometry-ready="true"/.test(stdout) &&
        stdout.includes("</html>")
      ) {
        geometryReady = true;
        stopChrome("SIGTERM");
        forceKillTimer = setTimeout(() => stopChrome("SIGKILL"), 2_000);
      }
    });
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    chrome.on("error", (error) => {
      failure = error;
    });
    chrome.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (failure) {
        reject(failure);
        return;
      }
      if (!geometryReady) {
        reject(
          new Error(
            `Chrome exited before geometry was ready (code=${code}, signal=${signal}).\n${stderr}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}

async function renderGeometry() {
  const chromePath = await findChrome();
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "info-project-directory-")
  );
  const fixturePath = path.join(tempDirectory, "fixture.html");
  const profilePath = path.join(tempDirectory, "chrome-profile");

  try {
    await writeFile(fixturePath, fixtureHtml(), "utf8");
    const args = [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--run-all-compositor-stages-before-draw",
      `--user-data-dir=${profilePath}`,
      `--window-size=${desktopViewportWidth},900`,
      "--virtual-time-budget=3000",
      "--allow-file-access-from-files",
      "--dump-dom",
      pathToFileURL(fixturePath).href
    ];

    if (typeof process.getuid === "function" && process.getuid() === 0) {
      args.unshift("--no-sandbox");
    }

    const stdout = await dumpDom(chromePath, args);
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
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
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
