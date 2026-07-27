import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function sourceBetween(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return sourceText.slice(start, end);
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  contains(className) {
    return this.values.has(className);
  }

  toggle(className, force) {
    const shouldAdd = force ?? !this.values.has(className);
    if (shouldAdd) {
      this.values.add(className);
    } else {
      this.values.delete(className);
    }
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    return this.listeners.get("click")?.();
  }
}

function createI18n() {
  const listeners = new Map();
  const location = {
    href: "https://example.test/",
    pathname: "/",
    search: "",
    hash: ""
  };
  const window = {
    location,
    history: {
      state: null,
      replaceState(state) {
        this.state = state;
      }
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    }
  };
  const document = {
    documentElement: { lang: "ja" },
    title: "",
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent: () => {}
  };

  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }

  return readUtf8("i18n.js").then((source) => {
    vm.runInNewContext(
      source,
      { window, document, URL, URLSearchParams, CustomEvent: FakeCustomEvent },
      { timeout: 1000 }
    );
    listeners.get("DOMContentLoaded")();
    return window.siteI18n;
  });
}

test("one fallback stays available without JavaScript and matches all canonical destinations", async () => {
  const [indexHtml, stylesSource, projects] = await Promise.all([
    readUtf8("index.html"),
    readUtf8("styles.css"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  const fallbackTags = [
    ...indexHtml.matchAll(/<div\b[^>]*\bid="projects-fallback"[^>]*>/gi)
  ];
  assert.equal(fallbackTags.length, 1, "The document must contain one shared fallback surface");
  assert.doesNotMatch(
    fallbackTags[0][0],
    /\b(?:hidden|aria-hidden)=/i,
    "The fallback must remain exposed when scripts do not run"
  );

  const fallbackContent = indexHtml.slice(
    fallbackTags[0].index,
    indexHtml.indexOf("</div>", fallbackTags[0].index) + "</div>".length
  );
  const fallbackLinks = [...fallbackContent.matchAll(/\bhref="([^"]+)"/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(fallbackLinks, projects.map((project) => project.link));
  assert.equal(new Set(fallbackLinks).size, 9);
  assert.doesNotMatch(
    indexHtml,
    /<noscript>[\s\S]*?projects-fallback[\s\S]*?<\/noscript>/i,
    "The reusable fallback must not be trapped inside noscript"
  );
  assert.match(
    stylesSource,
    /\.js-enabled\s+\.projects-fallback:not\(\.is-visible\)\s*\{\s*display:\s*none;/,
    "Enhanced rendering must hide the fallback before first paint"
  );
  assert.match(
    stylesSource,
    /\.projects-fallback a\s*\{[\s\S]*?min-height:\s*44px;/,
    "Fallback links must retain the minimum touch target height"
  );
});

test("persistent failures reuse the fallback and retry recovery removes duplicate destinations", async () => {
  const [scriptSource, projects, siteI18n] = await Promise.all([
    readUtf8("script.js"),
    readUtf8("projects.json").then(JSON.parse),
    createI18n()
  ]);
  const statusSource = sourceBetween(
    scriptSource,
    "function updateProjectStatus",
    "function renderProjects"
  );
  const loadingSource = sourceBetween(
    scriptSource,
    "function renderProjectLoading",
    'document.addEventListener("site-languagechange"'
  );
  const projectsStatus = new FakeElement("p");
  const projectsContainer = new FakeElement("div");
  const projectsFallback = new FakeElement("div");
  const consoleErrors = [];
  const responses = [
    { ok: false, status: 503 },
    new TypeError("offline"),
    { ok: true, json: async () => projects }
  ];
  const context = {
    console: { error: (...args) => consoleErrors.push(args) },
    document: { createElement: (tagName) => new FakeElement(tagName) },
    fetch: async () => {
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    projectState: "loading",
    projectStatusKeys: {
      loading: "projects.loading",
      ready: "projects.ready",
      error: "projects.error"
    },
    projects: null,
    projectsContainer,
    projectsFallback,
    projectsStatus,
    validateProject: () => {},
    window: { siteI18n }
  };
  context.renderProjects = () => {
    const cards = context.projects.map((project) => {
      const card = new FakeElement("article");
      card.destination = project.link;
      return card;
    });
    projectsContainer.replaceChildren(...cards);
    context.updateProjectStatus("ready");
  };

  vm.runInNewContext(`${statusSource}\n${loadingSource}`, context, { timeout: 1000 });

  await context.loadProjects();
  assert.equal(projectsStatus.textContent, "プロジェクトを読み込めませんでした。通信状況を確認して、もう一度お試しください。");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.getAttribute("aria-busy"), "false");
  assert.equal(projectsContainer.children.length, 1);
  const firstRetry = projectsContainer.children[0].children[0];
  assert.equal(firstRetry.textContent, "再読み込み");
  assert.equal(firstRetry.getAttribute("aria-describedby"), "projects-status");

  siteI18n.setLanguage("en", { persist: false });
  const repeatedFailure = firstRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), false);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "true");
  assert.equal(projectsContainer.children.length, 0);
  await repeatedFailure;
  assert.equal(projectsStatus.textContent, "Projects could not be loaded. Check your connection and try again.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsContainer.children.length, 1);
  const recoveryRetry = projectsContainer.children[0].children[0];
  assert.equal(recoveryRetry.textContent, "Try again");

  const recovery = recoveryRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), false);
  assert.equal(projectsContainer.children.length, 0);
  await recovery;

  assert.equal(projectsStatus.textContent, "9 projects loaded.");
  assert.equal(projectsStatus.classList.contains("sr-only"), true);
  assert.equal(projectsFallback.classList.contains("is-visible"), false);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "true");
  assert.deepEqual(
    projectsContainer.children.map((card) => card.destination),
    projects.map((project) => project.link)
  );
  assert.equal(new Set(projectsContainer.children.map((card) => card.destination)).size, 9);
  assert.equal(consoleErrors.length, 2);
});
