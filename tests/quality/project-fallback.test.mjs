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

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] : undefined;
}

function elementContent(source, tagName, className) {
  return source.match(
    new RegExp(
      `<${tagName}\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
      "i"
    )
  )?.[1];
}

function actionEntry(source, variant) {
  const anchor = source.match(
    new RegExp(
      `(<a\\b[^>]*\\bclass="[^"]*\\bproject-link--${variant}\\b[^"]*"[^>]*>)([\\s\\S]*?)<\\/a>`,
      "i"
    )
  );
  return anchor
    ? {
        label: anchor[2].match(/<span>([\s\S]*?)<\/span>/i)?.[1].trim(),
        link: attributeValue(anchor[1], "href")
      }
    : null;
}

function fallbackEntries(source) {
  const fallback = source.match(
    /<div\b[^>]*\bid="projects-fallback"[^>]*>([\s\S]*?)<\/div>/i
  )?.[1];
  assert.ok(fallback, "The document must contain one shared fallback surface");
  return [...fallback.matchAll(
    /(<article\b[^>]*\bclass="[^"]*\bprojects-fallback-card\b[^"]*"[^>]*>)([\s\S]*?)<\/article>/gi
  )].map(([, openingTag, body]) => ({
    description: elementContent(body, "p", "projects-fallback-description")?.trim(),
    kind: elementContent(body, "p", "projects-fallback-kind")?.trim(),
    permalink: attributeValue(
      body.match(
        /<a\b[^>]*\bclass="[^"]*\bprojects-fallback-permalink\b[^"]*"[^>]*>/i
      )?.[0] ?? "",
      "href"
    ),
    primary: actionEntry(body, "primary"),
    proof: actionEntry(body, "evidence"),
    source: actionEntry(body, "secondary"),
    stack: elementContent(body, "p", "projects-fallback-stack")?.trim() ?? null,
    tabIndex: attributeValue(openingTag, "tabindex"),
    targetId: attributeValue(openingTag, "id"),
    title: elementContent(body, "h3", "projects-fallback-title")?.trim()
  }));
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...classNames) {
    classNames.forEach((className) => this.values.add(className));
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
    documentElement: { lang: "ja", dataset: { siteRoot: "" } },
    title: "",
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
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
    return window.siteI18n;
  });
}

test("each static fallback exposes canonical localized decision cues without JavaScript", async () => {
  const [indexHtml, englishHtml, stylesSource, projects] = await Promise.all([
    readUtf8("index.html"),
    readUtf8("en/index.html"),
    readUtf8("styles.css"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  assert.equal(projects.length, 9);

  for (const [source, language] of [[indexHtml, "ja"], [englishHtml, "en"]]) {
    const fallbackTags = [
      ...source.matchAll(/<div\b[^>]*\bid="projects-fallback"[^>]*>/gi)
    ];
    assert.equal(fallbackTags.length, 1, "The document must contain one shared fallback surface");
    assert.doesNotMatch(
      fallbackTags[0][0],
      /\b(?:hidden|aria-hidden)=/i,
      "The fallback must remain exposed when scripts do not run"
    );
    assert.match(
      source,
      /<p\b[^>]*\bid="projects-status"[^>]*\bhidden\b[^>]*>/i,
      "The loading status must not claim indefinite work when scripts do not run"
    );
    assert.match(
      source,
      /<div\b[^>]*\bid="projects-container"[^>]*\baria-busy="false"[^>]*>/i
    );
    const entries = fallbackEntries(source);
    assert.equal(entries.length, 9);
    assert.deepEqual(
      entries.map(({ targetId }) => targetId),
      projects.map((project) => `project-${project.slug}`)
    );
    assert.deepEqual(
      entries.map(({ permalink }) => permalink),
      projects.map((project) => `#project-${project.slug}`)
    );
    assert.deepEqual(entries.map(({ tabIndex }) => tabIndex), Array(9).fill("-1"));
    assert.deepEqual(
      entries.map(({ primary }) => primary.link),
      projects.map((project) => project.link)
    );
    assert.deepEqual(
      entries.map(({ primary }) => primary.label),
      projects.map((project) => project.action[language])
    );
    assert.deepEqual(
      entries.map(({ title }) => title),
      projects.map((project) => project.title[language])
    );
    assert.deepEqual(
      entries.map(({ kind }) => kind),
      projects.map((project) => project.kind[language])
    );
    assert.deepEqual(
      entries.map(({ description }) => description),
      projects.map((project) => project.description[language])
    );
    assert.deepEqual(
      entries.map(({ stack }) => stack),
      projects.map((project) => project.stack?.join(" · ") ?? null)
    );
    assert.deepEqual(
      entries.map(({ source }) => source),
      projects.map((project) =>
        project.sourceAction
          ? { label: project.sourceAction[language], link: project.sourceLink }
          : null
      )
    );
    assert.deepEqual(
      entries.map(({ proof }) => proof?.link ?? null),
      projects.map((project) => project.proofLink ?? null)
    );
    assert.equal(new Set(entries.map(({ targetId }) => targetId)).size, 9);
    assert.equal(new Set(entries.map(({ primary }) => primary.link)).size, 9);
    assert.doesNotMatch(
      source,
      /<noscript>[\s\S]*?projects-fallback[\s\S]*?<\/noscript>/i,
      "The reusable fallback must not be trapped inside noscript"
    );
  }

  assert.doesNotMatch(
    stylesSource,
    /\.js-enabled\s+\.projects-fallback:not\(\.is-visible\)\s*\{\s*display:\s*none;/,
    "JavaScript detection alone must not hide the static project catalogue"
  );
  assert.match(
    stylesSource,
    /html\.projects-runtime-ready\s+\.projects-fallback:not\(\.is-visible\)\s*\{\s*display:\s*none;/,
    "Only an initialized Projects runtime may hide the fallback"
  );
  assert.match(
    stylesSource,
    /\.projects-fallback-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    "Fallback summary tracks must remain shrink-safe"
  );
  assert.match(
    stylesSource,
    /\.projects-fallback-card\s*\{[^}]*min-width:\s*0;[^}]*display:\s*grid;/s,
    "Fallback summaries must remain shrink-safe"
  );
  assert.match(
    stylesSource,
    /html:not\(\.js-enabled\)\s+\.site-header\s*\{[^}]*position:\s*static;/s,
    "The expanded no-JavaScript navigation must not cover native fragment arrivals"
  );
  assert.match(
    stylesSource,
    /html:not\(\.js-enabled\)\s+\.projects-fallback-card\s*\{[^}]*scroll-margin-block-start:\s*var\(--space-lg\);/s
  );
  assert.match(
    stylesSource,
    /\.projects-fallback-title\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 12rem;[^}]*overflow-wrap:\s*anywhere;/s
  );
  assert.match(
    stylesSource,
    /\.projects-fallback-actions\s*\{[^}]*margin-block-start:\s*var\(--space-2xs\);/s
  );
  assert.match(
    stylesSource,
    /\.project-link\s*\{[^}]*max-width:\s*100%;[^}]*min-height:\s*44px;[^}]*display:\s*inline-flex;[^}]*white-space:\s*nowrap;/s,
    "Fallback actions must remain 44px, single-line, and shrink-safe"
  );
  assert.match(
    stylesSource,
    /\.project-permalink\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/s
  );
  assert.match(
    stylesSource,
    /@media \(min-width:\s*48rem\)[\s\S]*?\.projects-fallback-list\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
  );
  assert.match(
    stylesSource,
    /:where\(a,\s*button\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--color-focus\);/s,
    "Fallback links must retain the global visible focus treatment"
  );
});

test("project ownership waits for a ready runtime when scripts or initialization fail", async () => {
  const [indexHtml, scriptSource, stylesSource] = await Promise.all([
    readUtf8("index.html"),
    readUtf8("script.js"),
    readUtf8("styles.css")
  ]);
  const inlineScript = indexHtml.match(/<script>\s*([\s\S]*?js-enabled[\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript, "The synchronous JavaScript detection marker must remain");

  const detectedRoot = { classList: new FakeClassList() };
  vm.runInNewContext(inlineScript, {
    document: { documentElement: detectedRoot }
  });
  assert.equal(detectedRoot.classList.contains("js-enabled"), true);
  assert.equal(detectedRoot.classList.contains("projects-runtime-ready"), false);
  assert.doesNotMatch(
    stylesSource,
    /\.js-enabled\s+\.projects-fallback:not\(\.is-visible\)/,
    "A blocked script.js must leave the generated fallback visible"
  );
  assert.match(
    stylesSource,
    /html\.projects-runtime-ready\s+\.projects-fallback:not\(\.is-visible\)/
  );

  function captureRuntimeInitializer(window) {
    let initialize;
    const documentElement = { classList: new FakeClassList() };
    const document = {
      documentElement,
      addEventListener(type, listener) {
        if (type === "DOMContentLoaded") {
          initialize = listener;
        }
      },
      getElementById: () => null
    };
    vm.runInNewContext(scriptSource, { document, window }, { timeout: 1000 });
    assert.equal(typeof initialize, "function");
    return { documentElement, initialize };
  }

  const missingI18n = captureRuntimeInitializer({});
  assert.throws(() => missingI18n.initialize(), /redirecting/);
  assert.equal(
    missingI18n.documentElement.classList.contains("projects-runtime-ready"),
    false,
    "A blocked i18n.js must not transfer ownership away from static summaries"
  );

  const earlyFailure = captureRuntimeInitializer({
    siteI18n: { redirecting: false }
  });
  assert.throws(
    () => earlyFailure.initialize(),
    /Required element #hamburger-menu was not found/
  );
  assert.equal(
    earlyFailure.documentElement.classList.contains("projects-runtime-ready"),
    false,
    "Initialization failures before Projects setup must preserve the fallback"
  );

  const statusSource = sourceBetween(
    scriptSource,
    "function updateProjectStatus",
    "function clearProjectDirectory"
  );
  const loadingSource = sourceBetween(
    scriptSource,
    "function renderProjectLoading",
    "function renderProjectError"
  );
  const documentElement = { classList: new FakeClassList() };
  const projectsStatus = new FakeElement("p");
  projectsStatus.hidden = true;
  const projectsContainer = new FakeElement("div");
  projectsContainer.setAttribute("aria-busy", "false");
  const projectsFallback = new FakeElement("div");
  const context = {
    PROJECT_RUNTIME_READY_CLASS: "projects-runtime-ready",
    clearProjectDirectory: () => {},
    document: { documentElement },
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
    resetProjectShareControllers: () => {},
    window: {
      siteI18n: {
        t: () => "Loading projects."
      }
    }
  };
  vm.runInNewContext(`${statusSource}\n${loadingSource}`, context, {
    timeout: 1000
  });

  context.window.siteI18n.t = () => {
    throw new Error("Injected translation initialization failure.");
  };
  assert.throws(
    () => context.renderProjectLoading(),
    /Injected translation initialization failure/
  );
  assert.equal(documentElement.classList.contains("projects-runtime-ready"), false);
  assert.equal(projectsStatus.hidden, true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), undefined);

  context.window.siteI18n.t = () => "Loading projects.";
  context.renderProjectLoading();
  assert.equal(documentElement.classList.contains("projects-runtime-ready"), true);
  assert.equal(projectsContainer.getAttribute("aria-busy"), "true");
  assert.equal(projectsStatus.hidden, false);
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "true");
  assert.equal(projectsFallback.classList.contains("is-visible"), false);
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
  const projectsDirectory = new FakeElement("nav");
  projectsDirectory.hidden = true;
  const projectsContainer = new FakeElement("div");
  const projectsFallback = new FakeElement("div");
  const documentElement = { classList: new FakeClassList() };
  projectsFallback.replaceChildren(
    ...projects.map((project) => Object.assign(new FakeElement("article"), {
      id: `project-${project.slug}`
    }))
  );
  const consoleErrors = [];
  let fragmentFocusCalls = 0;
  const responses = [
    { ok: false, status: 503 },
    new TypeError("offline"),
    { ok: true, json: async () => projects }
  ];
  const context = {
    PROJECT_RUNTIME_READY_CLASS: "projects-runtime-ready",
    console: { error: (...args) => consoleErrors.push(args) },
    document: {
      createElement: (tagName) => new FakeElement(tagName),
      documentElement
    },
    fetch: async () => {
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    projectState: "loading",
    projectShareControllers: [],
    projectStatusKeys: {
      loading: "projects.loading",
      ready: "projects.ready",
      error: "projects.error"
    },
    projects: null,
    projectsDirectory,
    projectsContainer,
    projectsFallback,
    projectsStatus,
    projectTargetId: (slug) => `project-${slug}`,
    scheduleProjectFragmentFocus: () => {
      fragmentFocusCalls += 1;
    },
    localizedValue: (value) => value[siteI18n.language],
    validateProject: () => {},
    window: { siteI18n }
  };
  context.renderProjects = () => {
    context.projectsFallback.replaceChildren();
    const cards = context.projects.map((project) => {
      const card = new FakeElement("article");
      card.destination = project.link;
      return card;
    });
    projectsContainer.replaceChildren(...cards);
    context.renderProjectDirectory();
    context.updateProjectStatus("ready");
  };

  vm.runInNewContext(`${statusSource}\n${loadingSource}`, context, { timeout: 1000 });

  assert.equal(documentElement.classList.contains("projects-runtime-ready"), false);
  await context.loadProjects();
  assert.equal(documentElement.classList.contains("projects-runtime-ready"), true);
  assert.equal(projectsStatus.textContent, "プロジェクトを読み込めませんでした。通信状況を確認して、もう一度お試しください。");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.getAttribute("aria-busy"), "false");
  assert.equal(projectsContainer.children.length, 1);
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsDirectory.hidden, true);
  assert.equal(projectsDirectory.children.length, 0);
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
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsDirectory.hidden, true);
  assert.equal(projectsDirectory.children.length, 0);
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
  assert.equal(projectsFallback.children.length, 0);
  assert.equal(projectsDirectory.hidden, false);
  assert.equal(projectsDirectory.children.length, 1);
  const directoryLinks = projectsDirectory.children[0].children.map(
    (item) => item.children[0]
  );
  assert.deepEqual(
    directoryLinks.map((link) => link.getAttribute("href")),
    projects.map((project) => `#project-${project.slug}`)
  );
  assert.equal(new Set(directoryLinks.map((link) => link.getAttribute("href"))).size, 9);
  assert.deepEqual(
    projectsContainer.children.map((card) => card.destination),
    projects.map((project) => project.link)
  );
  assert.equal(new Set(projectsContainer.children.map((card) => card.destination)).size, 9);
  assert.equal(consoleErrors.length, 2);
  assert.equal(fragmentFocusCalls, 2);

  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );
  assert.ok(
    renderSource.indexOf("projectsFallback.replaceChildren()") <
      renderSource.indexOf("projectsContainer.replaceChildren(fragment)"),
    "Static targets must leave the DOM before enhanced targets enter it"
  );
});
