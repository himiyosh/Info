import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
const repoRoot = process.cwd();
const projects = JSON.parse(
  await readFile(path.join(repoRoot, "projects.json"), "utf8")
);
const maxBrowserOutputBytes = 1024 * 1024;
const printViewport = { width: 1240, height: 1754 };
const routes = [
  { language: "ja", path: "/" },
  { language: "en", path: "/en/" }
];

const contentTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".woff2", "font/woff2"]
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) {
        pathname = `${pathname}index.html`;
      }

      const filePath = path.resolve(repoRoot, `.${pathname}`);
      if (
        filePath !== repoRoot &&
        !filePath.startsWith(`${repoRoot}${path.sep}`)
      ) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          contentTypes.get(path.extname(filePath)) ?? "application/octet-stream"
      });
      response.end(body);
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      response.writeHead(status).end(status === 404 ? "Not found" : "Server error");
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, "close");
    }
  };
}

function waitForDevToolsEndpoint(chrome) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Chrome did not expose a DevTools endpoint within 10 seconds.\n${stderr}`
        )
      );
    }, 10_000);

    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-maxBrowserOutputBytes);
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    chrome.once("close", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Chrome exited before exposing DevTools (code=${code}, signal=${signal}).\n${stderr}`
        )
      );
    });
  });
}

async function connectWebSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  await Promise.race([
    once(socket, "open"),
    delay(10_000).then(() => {
      throw new Error("Timed out connecting to Chrome DevTools");
    })
  ]);
  return socket;
}

function createCdpClient(socket) {
  let nextId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) {
      return;
    }

    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(
        new Error(
          `${message.error.message} (${message.error.code})`
        )
      );
      return;
    }
    resolve(message.result ?? {});
  });

  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) {
      reject(new Error("Chrome DevTools connection closed"));
    }
    pending.clear();
  });

  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify(payload));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function stopChrome(chrome) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) {
    return;
  }

  chrome.kill("SIGTERM");
  await Promise.race([
    once(chrome, "close"),
    delay(2_000).then(async () => {
      if (chrome.exitCode === null && chrome.signalCode === null) {
        chrome.kill("SIGKILL");
        await once(chrome, "close");
      }
    })
  ]);
}

async function launchChrome() {
  const chromePath = await findChrome();
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), "info-print-portfolio-")
  );
  const profilePath = path.join(tempDirectory, "chrome-profile");
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
    "--remote-debugging-port=0",
    `--user-data-dir=${profilePath}`,
    "about:blank"
  ];

  if (typeof process.getuid === "function" && process.getuid() === 0) {
    args.unshift("--no-sandbox");
  }

  const chrome = spawn(chromePath, args, {
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    const endpoint = await waitForDevToolsEndpoint(chrome);
    const socket = await connectWebSocket(endpoint);
    const client = createCdpClient(socket);
    const { targetId } = await client.send("Target.createTarget", {
      url: "about:blank"
    });
    const { sessionId } = await client.send("Target.attachToTarget", {
      flatten: true,
      targetId
    });
    await Promise.all([
      client.send("Page.enable", {}, sessionId),
      client.send("Runtime.enable", {}, sessionId),
      client.send(
        "Emulation.setDeviceMetricsOverride",
        {
          deviceScaleFactor: 1,
          height: printViewport.height,
          mobile: false,
          width: printViewport.width
        },
        sessionId
      ),
      client.send(
        "Emulation.setEmulatedMedia",
        { media: "print" },
        sessionId
      )
    ]);

    return {
      chrome,
      client,
      sessionId,
      tempDirectory,
      async close() {
        client.close();
        await stopChrome(chrome);
        await rm(tempDirectory, { force: true, recursive: true });
      }
    };
  } catch (error) {
    await stopChrome(chrome);
    await rm(tempDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function evaluate(browser, expression) {
  const response = await browser.client.send(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      expression,
      returnByValue: true
    },
    browser.sessionId
  );
  const result = response.result;
  if (result?.subtype === "error") {
    throw new Error(result.description ?? "Chrome evaluation failed");
  }
  return result?.value;
}

async function waitForPortfolio(browser) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      browser,
      `(async () => {
        await document.fonts.ready;
        return document.readyState === "complete" &&
          document.documentElement.classList.contains("projects-runtime-ready") &&
          document.querySelectorAll(".project-row").length === ${projects.length};
      })()`
    );
    if (ready) {
      return;
    }
    await delay(50);
  }

  throw new Error("Timed out waiting for the generated portfolio to render");
}

const snapshotExpression = `(() => {
  const describe = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent.trim().replace(/\\s+/g, " "),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      position: style.position,
      transform: style.transform,
      minHeight: style.minHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      breakInside: style.breakInside,
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight
    };
  };
  const isVisible = (element) => {
    const detail = describe(element);
    return Boolean(
      detail &&
      detail.display !== "none" &&
      detail.visibility !== "hidden" &&
      Number(detail.opacity) > 0 &&
      detail.width > 0 &&
      detail.height > 0
    );
  };
  const linkDetail = (element) => ({
    ...describe(element),
    href: element.href,
    printedDestination: getComputedStyle(element, "::after").content
  });
  const clippedText = (root) =>
    [...root.querySelectorAll("h1, h2, h3, p, a, span, strong")]
      .filter((element) => {
        if (!isVisible(element) || element.clientWidth === 0 || element.clientHeight === 0) {
          return false;
        }
        const style = getComputedStyle(element);
        const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
        const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
        return (
          (clipsX && element.scrollWidth > element.clientWidth + 1) ||
          (clipsY && element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => describe(element).text.slice(0, 120));
  const display = (selector) => describe(document.querySelector(selector))?.display ?? null;
  const rows = [...document.querySelectorAll(".project-row")].map((row) => ({
    id: row.id,
    row: describe(row),
    content: describe(row.querySelector(".project-content")),
    title: describe(row.querySelector("h3")),
    kind: describe(row.querySelector(".project-kind")),
    description: describe(row.querySelector(".project-description")),
    stack: describe(row.querySelector(".project-stack")),
    proof: describe(row.querySelector(".project-proof")),
    proofStatement:
      row.querySelector(".project-proof-text span:last-child")?.textContent.trim() ?? null,
    links: [...row.querySelectorAll(".project-link")].map(linkDetail),
    clippedText: clippedText(row)
  }));
  const githubLink = document.querySelector('.contact-links a[href^="https://github.com/"]');
  const emailLink = document.querySelector('.contact-links a[href^="mailto:"]');

  return {
    printMedia: matchMedia("print").matches,
    screenMedia: matchMedia("screen").matches,
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    identity: {
      wordmark: describe(document.querySelector(".wordmark")),
      heading: describe(document.querySelector(".hero h1")),
      role: describe(document.querySelector(".hero-role")),
      lede: describe(document.querySelector(".hero-lede"))
    },
    about: {
      section: describe(document.querySelector(".about")),
      heading: describe(document.querySelector(".about .section-heading")),
      copy: [...document.querySelectorAll(".about-copy p")].map(describe)
    },
    layout: {
      header: describe(document.querySelector(".site-header")),
      hero: describe(document.querySelector(".hero")),
      heroSticky: describe(document.querySelector(".hero-sticky")),
      projectsIntro: describe(document.querySelector(".projects-intro"))
    },
    decorations: {
      scrollProgress: display(".scroll-progress"),
      viewportStage: display(".viewport-stage"),
      navigation: display(".nav-menu"),
      menuToggle: display(".menu-toggle"),
      heroActions: display(".hero-actions"),
      projectDirectory: display(".project-directory"),
      projectStatus: display(".projects-status"),
      retry: display(".retry-button"),
      projectMedia: display(".project-media"),
      projectPermalink: display(".project-permalink"),
      projectShare: display(".project-share-button"),
      projectShareStatus: display(".project-share-status"),
      contactCopy: display(".contact-copy-button"),
      contactCopyStatus: display(".contact-copy-status"),
      footerMarquee: display(".footer-marquee"),
      backToTop: display(".footer-meta > a")
    },
    rows,
    contact: {
      section: describe(document.querySelector(".contact")),
      email: emailLink ? linkDetail(emailLink) : null,
      github: githubLink ? linkDetail(githubLink) : null
    },
    footer: {
      disclaimer: describe(document.querySelector(".footer-disclaimer"))
    },
    clippedText: clippedText(document.body)
  };
})()`;

async function renderPrintSnapshot(browser, url) {
  await browser.client.send(
    "Page.navigate",
    { url },
    browser.sessionId
  );
  await waitForPortfolio(browser);
  const snapshot = await evaluate(browser, snapshotExpression);
  const { data } = await browser.client.send(
    "Page.printToPDF",
    {
      displayHeaderFooter: false,
      marginBottom: 0.45,
      marginLeft: 0.45,
      marginRight: 0.45,
      marginTop: 0.45,
      paperHeight: 11.7,
      paperWidth: 8.27,
      printBackground: false
    },
    browser.sessionId
  );
  const pdf = Buffer.from(data, "base64");
  return {
    ...snapshot,
    pdf: {
      bytes: pdf.length,
      signature: pdf.subarray(0, 5).toString("ascii")
    }
  };
}

function diagnostic(language, snapshot) {
  return JSON.stringify(
    {
      language,
      printMedia: snapshot.printMedia,
      screenMedia: snapshot.screenMedia,
      document: snapshot.document,
      layout: snapshot.layout,
      decorations: snapshot.decorations,
      projectRows: snapshot.rows.map(({ id, row, content, clippedText }) => ({
        id,
        row,
        content,
        clippedText
      })),
      clippedText: snapshot.clippedText,
      pdf: snapshot.pdf
    },
    null,
    2
  );
}

function normalizeRenderedText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function assertVisible(detail, message, context) {
  assert.ok(detail, `${message}\n${context}`);
  assert.notEqual(detail.display, "none", `${message}\n${context}`);
  assert.notEqual(detail.visibility, "hidden", `${message}\n${context}`);
  assert.ok(Number(detail.opacity) > 0, `${message}\n${context}`);
  assert.ok(detail.width > 0 && detail.height > 0, `${message}\n${context}`);
}

function assertPrintSnapshot(language, snapshot) {
  const expected = translations[language];
  const context = diagnostic(language, snapshot);

  assert.equal(snapshot.printMedia, true, context);
  assert.equal(snapshot.screenMedia, false, context);
  assert.equal(snapshot.pdf.signature, "%PDF-", context);
  assert.ok(snapshot.pdf.bytes > 20_000, context);

  assertVisible(snapshot.identity.wordmark, "Identity wordmark must print", context);
  assert.equal(snapshot.identity.wordmark.text, "himiyosh", context);
  assertVisible(snapshot.identity.heading, "Hero identity heading must print", context);
  assert.ok(
    snapshot.identity.heading.text.includes(
      normalizeRenderedText(expected.hero.titleLine1)
    ),
    context
  );
  assert.ok(
    snapshot.identity.heading.text.includes(
      normalizeRenderedText(expected.hero.titleLine2)
    ),
    context
  );
  assertVisible(snapshot.identity.role, "Professional role must print", context);
  assert.equal(
    snapshot.identity.role.text,
    normalizeRenderedText(expected.hero.role),
    context
  );
  assertVisible(snapshot.identity.lede, "Hero summary must print", context);
  assert.equal(
    snapshot.identity.lede.text,
    normalizeRenderedText(expected.hero.lede),
    context
  );

  assert.equal(snapshot.about.copy.length, 3, context);
  assert.deepEqual(
    snapshot.about.copy.map(({ text }) => text),
    [expected.about.content, expected.about.site, expected.about.statement].map(
      normalizeRenderedText
    ),
    context
  );
  snapshot.about.copy.forEach((detail) =>
    assertVisible(detail, "Every About paragraph must print", context)
  );

  for (const [name, display] of Object.entries(snapshot.decorations)) {
    assert.ok(
      display === null || display === "none",
      `${name} must not consume print space\n${context}`
    );
  }

  assert.equal(snapshot.layout.header.position, "static", context);
  assert.equal(snapshot.layout.heroSticky.position, "static", context);
  assert.equal(snapshot.layout.heroSticky.transform, "none", context);
  assert.equal(snapshot.layout.heroSticky.opacity, "1", context);
  assert.equal(snapshot.about.heading.position, "static", context);
  assert.ok(parseFloat(snapshot.layout.hero.minHeight) === 0, context);
  assert.ok(parseFloat(snapshot.about.section.minHeight) === 0, context);
  assert.ok(parseFloat(snapshot.layout.projectsIntro.minHeight) === 0, context);

  assert.equal(snapshot.rows.length, projects.length, context);
  snapshot.rows.forEach((rendered, index) => {
    const project = projects[index];
    const expectedTitle = project.title[language];
    const expectedDescription = project.description[language];
    assert.equal(rendered.id, `project-${project.slug}`, context);
    assertVisible(rendered.title, `${expectedTitle} title must print`, context);
    assertVisible(
      rendered.description,
      `${expectedTitle} description must print`,
      context
    );
    assert.equal(rendered.title.text, normalizeRenderedText(expectedTitle), context);
    assert.equal(
      rendered.description.text,
      normalizeRenderedText(expectedDescription),
      context
    );
    assert.equal(rendered.row.position, "static", context);
    assert.equal(rendered.row.transform, "none", context);
    assert.equal(rendered.row.opacity, "1", context);
    assert.equal(rendered.content.transform, "none", context);
    assert.equal(rendered.content.opacity, "1", context);
    assert.equal(rendered.row.breakInside, "avoid", context);
    assert.ok(parseFloat(rendered.row.minHeight) === 0, context);
    assert.ok(rendered.row.height < 900, context);
    assert.ok(rendered.row.scrollWidth <= rendered.row.clientWidth + 1, context);
    assert.deepEqual(rendered.clippedText, [], context);

    const expectedLinks = [
      [project.action[language], project.link],
      ...(project.sourceLink
        ? [[project.sourceAction[language], project.sourceLink]]
        : []),
      ...(project.proofLink
        ? [[expected.projects.proofAction, project.proofLink]]
        : [])
    ];
    assert.equal(rendered.links.length, expectedLinks.length, context);
    expectedLinks.forEach(([label, href], linkIndex) => {
      const link = rendered.links[linkIndex];
      assertVisible(link, `${expectedTitle} action must print`, context);
      assert.equal(link.text, normalizeRenderedText(label), context);
      assert.equal(link.href, href, context);
      assert.match(link.printedDestination, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), context);
    });

    if (project.proof) {
      assertVisible(rendered.proof, `${expectedTitle} proof must print`, context);
      assert.equal(
        normalizeRenderedText(rendered.proofStatement),
        normalizeRenderedText(project.proof[language]),
        context
      );
    } else {
      assert.equal(rendered.proof, null, context);
      assert.equal(rendered.proofStatement, null, context);
    }
  });

  assertVisible(snapshot.contact.email, "Email contact must print", context);
  assert.equal(snapshot.contact.email.href, "mailto:himiyosh@gmail.com", context);
  assert.match(snapshot.contact.email.text, /himiyosh@gmail\.com/, context);
  assertVisible(snapshot.contact.github, "GitHub contact must print", context);
  assert.equal(snapshot.contact.github.href, "https://github.com/himiyosh", context);
  assert.match(snapshot.contact.github.text, /GitHub.*@himiyosh/, context);
  assert.match(snapshot.contact.github.printedDestination, /https:\/\/github\.com\/himiyosh/, context);
  assertVisible(snapshot.footer.disclaimer, "Personal-site disclaimer must print", context);
  assert.equal(
    snapshot.footer.disclaimer.text,
    normalizeRenderedText(expected.disclaimer),
    context
  );

  assert.ok(
    snapshot.document.scrollWidth <= snapshot.document.clientWidth + 1,
    context
  );
  assert.ok(snapshot.document.scrollHeight < 7_500, context);
  assert.deepEqual(snapshot.clippedText, [], context);
}

test("JA and EN generated pages provide a complete compact print portfolio", async () => {
  const server = await startStaticServer();
  const browser = await launchChrome();

  try {
    const snapshots = [];
    for (const route of routes) {
      snapshots.push([
        route.language,
        await renderPrintSnapshot(browser, `${server.origin}${route.path}`)
      ]);
    }
    snapshots.forEach(([language, snapshot]) =>
      assertPrintSnapshot(language, snapshot)
    );
  } finally {
    await browser.close();
    await server.close();
  }
});
