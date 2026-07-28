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
const routes = [
  ["ja", "/"],
  ["en", "/en/"]
];
const expectedProjectActionCount = projects.reduce((count, project) =>
  count + 1 + Number(Boolean(project.sourceLink)) +
    Number(Boolean(project.proofLink)), 0);
const hiddenSelectors = [
  ".scroll-progress",
  ".viewport-stage",
  ".nav-menu",
  ".menu-toggle",
  ".hero-actions",
  ".project-directory",
  ".projects-status",
  ".retry-button",
  ".project-media",
  ".project-permalink",
  ".project-share-button",
  ".project-share-status",
  ".contact-copy-button",
  ".contact-copy-status",
  ".footer-marquee",
  ".footer-meta > a"
];
const contentTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2"
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalize = (value) => value.trim().replace(/\s+/g, " ");

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
      // Keep looking for an installed browser.
    }
  }
  assert.fail(`Chrome was not found. Checked: ${candidates.join(", ")}`);
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname
      );
      pathname = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const filePath = path.resolve(repoRoot, `.${pathname}`);
      if (!filePath.startsWith(`${repoRoot}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          contentTypes[path.extname(filePath)] ?? "application/octet-stream"
      });
      response.end(await readFile(filePath));
    } catch (error) {
      response
        .writeHead(error?.code === "ENOENT" ? 404 : 500)
        .end(error?.code === "ENOENT" ? "Not found" : "Server error");
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

function waitForEndpoint(chrome) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error(`Chrome DevTools timed out.\n${stderr}`)),
      10_000
    );
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
      const endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (endpoint) {
        clearTimeout(timeout);
        resolve(endpoint);
      }
    });
    chrome.once("error", reject);
    chrome.once("close", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Chrome exited before DevTools was ready (code=${code}, signal=${signal}).\n${stderr}`
        )
      );
    });
  });
}

function createClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) {
      command.reject(
        new Error(`${message.error.message} (${message.error.code})`)
      );
    } else {
      command.resolve(message.result ?? {});
    }
  });
  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) {
      reject(new Error("Chrome DevTools connection closed"));
    }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close()
  };
}

async function stopChrome(chrome) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return;
  const gracefulClose = once(chrome, "close");
  chrome.kill("SIGTERM");
  const closed = await Promise.race([
    gracefulClose.then(() => true),
    delay(2_000).then(() => false)
  ]);
  if (!closed && chrome.exitCode === null && chrome.signalCode === null) {
    const forcedClose = once(chrome, "close");
    chrome.kill("SIGKILL");
    await forcedClose;
  }
}

async function launchChrome() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "info-print-"));
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
    `--user-data-dir=${path.join(tempDirectory, "profile")}`,
    "about:blank"
  ];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    args.unshift("--no-sandbox");
  }
  const chrome = spawn(await findChrome(), args, {
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    const browserEndpoint = await waitForEndpoint(chrome);
    const debugOrigin = browserEndpoint
      .replace(/^ws:/, "http:")
      .replace(/\/devtools\/browser\/.*$/, "");
    const targets = await fetch(`${debugOrigin}/json/list`, {
      signal: AbortSignal.timeout(5_000)
    }).then((response) => response.json());
    const pageEndpoint = targets.find(({ type }) => type === "page")
      ?.webSocketDebuggerUrl;
    assert.ok(pageEndpoint, "Chrome did not expose a page target");
    const socket = new WebSocket(pageEndpoint);
    await Promise.race([
      once(socket, "open"),
      delay(10_000).then(() => {
        throw new Error("Chrome DevTools WebSocket timed out");
      })
    ]);
    const client = createClient(socket);
    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 1,
        height: 1754,
        mobile: false,
        width: 1240
      }),
      client.send("Emulation.setEmulatedMedia", { media: "print" })
    ]);
    return {
      client,
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
  const { result } = await browser.client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true
  });
  if (result?.subtype === "error") {
    throw new Error(result.description ?? "Chrome evaluation failed");
  }
  return result?.value;
}

async function configureBrowser(browser, { height, media, width }) {
  await Promise.all([
    browser.client.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height,
      mobile: false,
      width
    }),
    browser.client.send("Emulation.setEmulatedMedia", { media })
  ]);
}

async function waitForPortfolio(browser) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (
      await evaluate(
        browser,
        `(async () => {
          await document.fonts.ready;
          return document.readyState === "complete" &&
            document.documentElement.classList.contains("projects-runtime-ready") &&
            document.querySelectorAll(".project-row").length === ${projects.length};
        })()`
      )
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for the portfolio to render");
}

const textSpacingExpression = `(async () => {
  const frames = () => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const normalize = (value) => value.trim().replace(/\\s+/g, " ");
  const override = document.createElement("style");
  override.textContent = \`
    html, body, body * {
      line-height: 1.5 !important;
      letter-spacing: 0.12em !important;
      word-spacing: 0.16em !important;
    }
    p { margin-block-end: 2em !important; }
  \`;
  document.head.append(override);
  await document.fonts.ready;
  await frames();

  const visible = (element) => {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const contained = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= innerWidth + 1;
  };
  const clipped = (element) => {
    const style = getComputedStyle(element);
    return (
      ["hidden", "clip"].includes(style.overflowX) &&
        element.scrollWidth > element.clientWidth + 1
    ) || (
      ["hidden", "clip"].includes(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 1
    );
  };
  const clippedLabel = (control) => [control, ...control.querySelectorAll("*")]
    .some((element) => visible(element) &&
      !element.matches(".sr-only, .project-directory-title, .project-directory-kind") &&
      !element.closest(".sr-only, [aria-hidden='true']") && clipped(element));
  const focusable = (element) => {
    element.focus({ preventScroll: true });
    const result = document.activeElement === element;
    element.blur();
    return result;
  };
  const activate = async (button) => {
    const status = document.getElementById(button.getAttribute("aria-describedby"));
    button.click();
    for (let attempt = 0; attempt < 100 && !status.textContent.trim(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return visible(status) && contained(status) && !clipped(status) &&
      ["success", "error"].includes(status.dataset.state);
  };

  const nav = document.querySelector(".nav-menu");
  const menu = document.querySelector(".menu-toggle");
  if (!visible(nav)) {
    menu.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const navLinks = [...nav.querySelectorAll("a")];
  const navAvailable = visible(nav) && navLinks.length === 4 &&
    navLinks.every((link) => visible(link) && focusable(link) && !clippedLabel(link));
  if (menu.getAttribute("aria-expanded") === "true") menu.click();

  const shareFlow = await activate(document.querySelector(".project-share-button"));
  const copyFlow = await activate(document.querySelector(".contact-copy-button"));
  const projectStatus = document.querySelector("#projects-status");
  projectStatus.classList.remove("sr-only");
  projectStatus.textContent = window.siteI18n.t("projects.error");
  const statusText = [projectStatus, document.querySelector(".project-share-status"),
    document.querySelector("#copy-email-status")];
  const statusesVisible = statusText.every((status) =>
    visible(status) && contained(status) && !clipped(status));

  scrollTo({ behavior: "instant", left: 0, top: 0 });
  await frames();
  const directory = [...document.querySelectorAll(".project-directory-link")].map(
    (link) => {
      const title = link.querySelector(".project-directory-title");
      const target = document.querySelector(link.hash);
      return {
        context: normalize(title.textContent) ===
          normalize(target?.querySelector("h3")?.textContent ?? ""),
        ellipsized: title.scrollWidth > title.clientWidth + 1 &&
          getComputedStyle(title).textOverflow === "ellipsis",
        target: visible(target)
      };
    });
  const rows = [...document.querySelectorAll(".project-row")];
  const controls = [...document.querySelectorAll(
    ".hero-actions a, .project-directory-link, .project-permalink, " +
    ".project-share-button, .project-link, .contact-links a, .contact-copy-button"
  )];
  const bodyStyle = getComputedStyle(document.body);
  const paragraphStyle = getComputedStyle(document.querySelector(".about-copy p"));
  const em = (value, size) => Math.round((parseFloat(value) /
    parseFloat(size)) * 100) / 100;
  const root = document.documentElement;
  return {
    actionCount: document.querySelectorAll(".project-link").length,
    contacts: document.querySelectorAll(
      '.contact-links a[href^="mailto:"], .contact-links a[href^="https://github.com/"]'
    ).length,
    controlCount: controls.length,
    controlsAvailable: controls.every((control) =>
      visible(control) && contained(control) && focusable(control) &&
      !clippedLabel(control)),
    copyFlow,
    directory,
    navAvailable,
    overflow: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth,
    projectCount: rows.length,
    projectIdentities: rows.every((row) => {
      const title = row.querySelector("h3");
      return visible(title) && contained(title);
    }),
    shareButtons: document.querySelectorAll(".project-share-button").length,
    shareFlow,
    spacing: {
      letter: em(bodyStyle.letterSpacing, bodyStyle.fontSize),
      line: em(bodyStyle.lineHeight, bodyStyle.fontSize),
      paragraph: em(paragraphStyle.marginBlockEnd, paragraphStyle.fontSize),
      word: em(bodyStyle.wordSpacing, bodyStyle.fontSize)
    },
    statusesVisible
  };
})()`;

const snapshotExpression = `(() => {
  const inspect = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent.trim().replace(/\\s+/g, " "),
      display: style.display,
      visible:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0,
      opacity: style.opacity,
      position: style.position,
      transform: style.transform,
      minHeight: style.minHeight,
      breakInside: style.breakInside,
      height: rect.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    };
  };
  const link = (element) => ({
    ...inspect(element),
    href: element.href,
    label: element.firstElementChild?.textContent.trim() ?? element.textContent.trim(),
    destination: getComputedStyle(element, "::after").content
  });
  const clipped = (root) =>
    [...root.querySelectorAll("h1, h2, h3, p, a, span, strong")]
      .filter((element) => {
        const detail = inspect(element);
        if (!detail?.visible || !element.clientWidth || !element.clientHeight) return false;
        const style = getComputedStyle(element);
        return (
          ((style.overflowX === "hidden" || style.overflowX === "clip") &&
            element.scrollWidth > element.clientWidth + 1) ||
          ((style.overflowY === "hidden" || style.overflowY === "clip") &&
            element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => inspect(element).text.slice(0, 100));
  const rows = [...document.querySelectorAll(".project-row")].map((row) => ({
    id: row.id,
    row: inspect(row),
    content: inspect(row.querySelector(".project-content")),
    title: inspect(row.querySelector("h3")),
    description: inspect(row.querySelector(".project-description")),
    proof: inspect(row.querySelector(".project-proof")),
    proofText:
      row.querySelector(".project-proof-text span:last-child")?.textContent.trim() ?? null,
    links: [...row.querySelectorAll(".project-link")].map(link),
    clipped: clipped(row)
  }));
  const email = document.querySelector('.contact-links a[href^="mailto:"]');
  const github = document.querySelector('.contact-links a[href^="https://github.com/"]');
  return {
    media: {
      print: matchMedia("print").matches,
      screen: matchMedia("screen").matches
    },
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    identity: {
      wordmark: inspect(document.querySelector(".wordmark")),
      heading: inspect(document.querySelector(".hero h1")),
      headingLines: [...document.querySelectorAll(".hero h1 span")].map(inspect),
      role: inspect(document.querySelector(".hero-role")),
      lede: inspect(document.querySelector(".hero-lede"))
    },
    about: {
      section: inspect(document.querySelector(".about")),
      heading: inspect(document.querySelector(".about .section-heading")),
      copy: [...document.querySelectorAll(".about-copy p")].map(inspect)
    },
    layout: {
      header: inspect(document.querySelector(".site-header")),
      hero: inspect(document.querySelector(".hero")),
      heroSticky: inspect(document.querySelector(".hero-sticky")),
      projectsIntro: inspect(document.querySelector(".projects-intro"))
    },
    hidden: Object.fromEntries(
      ${JSON.stringify(hiddenSelectors)}.map((selector) => [
        selector,
        inspect(document.querySelector(selector))?.display ?? null
      ])
    ),
    rows,
    contact: {
      email: email ? link(email) : null,
      github: github ? link(github) : null
    },
    disclaimer: inspect(document.querySelector(".footer-disclaimer")),
    clipped: clipped(document.body)
  };
})()`;

async function render(browser, url) {
  await browser.client.send("Page.navigate", { url });
  await waitForPortfolio(browser);
  const snapshot = await evaluate(browser, snapshotExpression);
  const { data } = await browser.client.send("Page.printToPDF", {
    displayHeaderFooter: false,
    marginBottom: 0.45,
    marginLeft: 0.45,
    marginRight: 0.45,
    marginTop: 0.45,
    paperHeight: 11.7,
    paperWidth: 8.27,
    printBackground: false
  });
  const pdf = Buffer.from(data, "base64");
  snapshot.pdf = {
    bytes: pdf.length,
    signature: pdf.subarray(0, 5).toString("ascii")
  };
  return snapshot;
}

async function renderTextSpacing(browser, url, width) {
  await configureBrowser(browser, {
    height: width === 320 ? 900 : 1024,
    media: "screen",
    width
  });
  await browser.client.send("Page.navigate", { url });
  await waitForPortfolio(browser);
  return evaluate(browser, textSpacingExpression);
}

function diagnostic(language, snapshot) {
  return JSON.stringify(
    {
      language,
      media: snapshot.media,
      document: snapshot.document,
      layout: snapshot.layout,
      hidden: snapshot.hidden,
      rows: snapshot.rows.map(({ id, row, content, clipped }) => ({
        id,
        row,
        content,
        clipped
      })),
      clipped: snapshot.clipped,
      pdf: snapshot.pdf
    },
    null,
    2
  );
}

function assertVisible(detail, message, context) {
  assert.equal(detail?.visible, true, `${message}\n${context}`);
}

function assertSnapshot(language, snapshot) {
  const expected = translations[language];
  const context = diagnostic(language, snapshot);
  assert.deepEqual(snapshot.media, { print: true, screen: false }, context);
  assert.equal(snapshot.pdf.signature, "%PDF-", context);
  assert.ok(snapshot.pdf.bytes > 20_000, context);

  assertVisible(snapshot.identity.wordmark, "Identity wordmark must print", context);
  assert.equal(snapshot.identity.wordmark.text, "himiyosh", context);
  assertVisible(snapshot.identity.heading, "Identity heading must print", context);
  snapshot.identity.headingLines.forEach((line) =>
    assertVisible(line, "Every identity heading line must print", context)
  );
  assert.ok(
    snapshot.identity.heading.text.includes(normalize(expected.hero.titleLine1)),
    context
  );
  assert.ok(
    snapshot.identity.heading.text.includes(normalize(expected.hero.titleLine2)),
    context
  );
  assertVisible(snapshot.identity.role, "Professional role must print", context);
  assert.equal(snapshot.identity.role.text, normalize(expected.hero.role), context);
  assertVisible(snapshot.identity.lede, "Identity summary must print", context);
  assert.equal(snapshot.identity.lede.text, normalize(expected.hero.lede), context);

  assert.deepEqual(
    snapshot.about.copy.map(({ text }) => text),
    [expected.about.content, expected.about.site, expected.about.statement].map(
      normalize
    ),
    context
  );
  snapshot.about.copy.forEach((paragraph) =>
    assertVisible(paragraph, "Every About paragraph must print", context)
  );
  for (const [selector, display] of Object.entries(snapshot.hidden)) {
    assert.ok(
      display === null || display === "none",
      `${selector} must not consume print space\n${context}`
    );
  }

  assert.equal(snapshot.layout.header.position, "static", context);
  assert.equal(snapshot.layout.heroSticky.position, "static", context);
  assert.equal(snapshot.layout.heroSticky.transform, "none", context);
  assert.equal(snapshot.layout.heroSticky.opacity, "1", context);
  assert.equal(snapshot.about.heading.position, "static", context);
  for (const detail of [
    snapshot.layout.hero,
    snapshot.about.section,
    snapshot.layout.projectsIntro
  ]) {
    assert.equal(parseFloat(detail.minHeight), 0, context);
  }

  assert.equal(snapshot.rows.length, projects.length, context);
  snapshot.rows.forEach((rendered, index) => {
    const project = projects[index];
    const title = project.title[language];
    assert.equal(rendered.id, `project-${project.slug}`, context);
    assertVisible(rendered.title, `${title} title must print`, context);
    assertVisible(rendered.description, `${title} description must print`, context);
    assert.equal(rendered.title.text, normalize(title), context);
    assert.equal(
      rendered.description.text,
      normalize(project.description[language]),
      context
    );
    assert.deepEqual(
      {
        position: rendered.row.position,
        transform: rendered.row.transform,
        opacity: rendered.row.opacity,
        contentTransform: rendered.content.transform,
        contentOpacity: rendered.content.opacity,
        breakInside: rendered.row.breakInside,
        minHeight: parseFloat(rendered.row.minHeight)
      },
      {
        position: "static",
        transform: "none",
        opacity: "1",
        contentTransform: "none",
        contentOpacity: "1",
        breakInside: "avoid",
        minHeight: 0
      },
      context
    );
    assert.ok(rendered.row.height < 900, context);
    assert.ok(rendered.row.scrollWidth <= rendered.row.clientWidth + 1, context);
    assert.deepEqual(rendered.clipped, [], context);

    const links = [
      [project.action[language], project.link],
      ...(project.sourceLink
        ? [[project.sourceAction[language], project.sourceLink]]
        : []),
      ...(project.proofLink
        ? [[expected.projects.proofAction, project.proofLink]]
        : [])
    ];
    assert.equal(rendered.links.length, links.length, context);
    links.forEach(([label, href], linkIndex) => {
      const renderedLink = rendered.links[linkIndex];
      assertVisible(renderedLink, `${title} action must print`, context);
      assert.equal(renderedLink.label, normalize(label), context);
      assert.equal(renderedLink.href, href, context);
      assert.ok(renderedLink.destination.includes(href), context);
    });
    if (project.proof) {
      assertVisible(rendered.proof, `${title} proof must print`, context);
      assert.equal(
        normalize(rendered.proofText),
        normalize(project.proof[language]),
        context
      );
    } else {
      assert.equal(rendered.proof, null, context);
      assert.equal(rendered.proofText, null, context);
    }
  });

  assertVisible(snapshot.contact.email, "Email contact must print", context);
  assert.equal(snapshot.contact.email.href, "mailto:himiyosh@gmail.com", context);
  assert.match(snapshot.contact.email.text, /himiyosh@gmail\.com/, context);
  assertVisible(snapshot.contact.github, "GitHub contact must print", context);
  assert.equal(snapshot.contact.github.href, "https://github.com/himiyosh", context);
  assert.ok(
    snapshot.contact.github.destination.includes("https://github.com/himiyosh"),
    context
  );
  assertVisible(snapshot.disclaimer, "Personal-site disclaimer must print", context);
  assert.equal(snapshot.disclaimer.text, normalize(expected.disclaimer), context);
  assert.ok(
    snapshot.document.scrollWidth <= snapshot.document.clientWidth + 1,
    context
  );
  assert.ok(snapshot.document.scrollHeight < 7_500, context);
  assert.deepEqual(snapshot.clipped, [], context);
}

test("JA and EN generated pages provide a complete compact print portfolio", async () => {
  const server = await startServer();
  const browser = await launchChrome();
  try {
    for (const [language, route] of routes) {
      assertSnapshot(language, await render(browser, `${server.origin}${route}`));
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("JA and EN generated pages tolerate WCAG text spacing at 320px and 768px", async () => {
  const server = await startServer();
  const browser = await launchChrome();
  const results = [];
  try {
    for (const [language, route] of routes) {
      for (const width of [320, 768]) {
        results.push({
          language,
          snapshot: await renderTextSpacing(
            browser,
            `${server.origin}${route}?text-spacing=${width}`,
            width
          ),
          width
        });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const failures = results.flatMap(({ language, snapshot, width }) => {
    const current = [];
    const expect = (condition, signal) => {
      if (!condition) current.push(`${language}@${width}: ${signal}`);
    };
    expect(snapshot.overflow === 0, `horizontal overflow ${snapshot.overflow}px`);
    expect(
      JSON.stringify(snapshot.spacing) ===
        JSON.stringify({ letter: 0.12, line: 1.5, paragraph: 2, word: 0.16 }),
      `spacing override ${JSON.stringify(snapshot.spacing)}`
    );
    expect(snapshot.navAvailable, "navigation unavailable");
    expect(snapshot.projectCount === projects.length, "project identity count changed");
    expect(snapshot.projectIdentities, "project identity outside the viewport");
    expect(snapshot.directory.length === projects.length, "directory count changed");
    expect(snapshot.directory.every(({ context, target }) => context && target), "directory context lost");
    expect(snapshot.actionCount === expectedProjectActionCount, "project action count changed");
    expect(snapshot.shareButtons === projects.length, "project share action count changed");
    expect(snapshot.contacts === 2, "contact path count changed");
    expect(snapshot.controlCount === 55, "important action count changed");
    expect(snapshot.controlsAvailable, "important action or label lost");
    expect(snapshot.statusesVisible, "status text hidden or clipped");
    expect(snapshot.shareFlow, "project share flow lost");
    expect(snapshot.copyFlow, "contact copy flow lost");
    return current;
  });
  const diagnostic = results.map(({ language, snapshot, width }) => ({
    actions: snapshot.actionCount,
    contacts: snapshot.contacts,
    contexts: snapshot.directory.filter(({ context }) => context).length,
    ellipsized: snapshot.directory.filter(({ ellipsized }) => ellipsized).length,
    language,
    overflow: snapshot.overflow,
    projects: snapshot.projectCount,
    width
  }));
  assert.deepEqual(failures, [], JSON.stringify(diagnostic, null, 2));
});
