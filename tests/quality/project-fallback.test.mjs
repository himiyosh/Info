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
  const initialLoadingSource = sourceBetween(
    scriptSource,
    "function renderProjectLoading",
    "function renderProjectError"
  );
  const loadingSource = sourceBetween(
    scriptSource,
    "function renderProjectLoading",
    'document.addEventListener("site-languagechange"'
  );
  const documentElement = { classList: new FakeClassList() };
  const projectsStatus = new FakeElement("p");
  projectsStatus.hidden = true;
  const projectsContainer = new FakeElement("div");
  projectsContainer.setAttribute("aria-busy", "false");
  const projectsFallback = new FakeElement("div");
  const context = {
    AbortController,
    PROJECT_REQUEST_TIMEOUT_MS: 8_000,
    PROJECT_RUNTIME_READY_CLASS: "projects-runtime-ready",
    clearProjectDirectory: () => {},
    document: { documentElement },
    fetch: () => new Promise(() => {}),
    projectLoadController: null,
    projectLoadSequence: 0,
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
      clearTimeout: () => {},
      setTimeout: () => 1,
      siteI18n: {
        resolveSitePath: (value) => value,
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
  const unresolvedLoad = context.loadProjects();
  assert.equal(typeof unresolvedLoad.then, "function");
  assert.doesNotMatch(
    initialLoadingSource,
    /classList\.add\(PROJECT_RUNTIME_READY_CLASS\)/,
    "Initial loading must not claim runtime ownership before validated dynamic content exists"
  );
  assert.equal(documentElement.classList.contains("projects-runtime-ready"), false);
  assert.equal(projectsContainer.getAttribute("aria-busy"), "true");
  assert.equal(projectsStatus.hidden, false);
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
});

test("catalogue replacement preserves project controls without stealing outside focus", async () => {
  const scriptSource = await readUtf8("script.js");
  const focusSource = sourceBetween(
    scriptSource,
    "function captureProjectCatalogueFocus",
    "function updateProjectStatus"
  );
  const document = {
    activeElement: null,
    body: {},
    documentElement: { style: { scrollBehavior: "" } }
  };
  const scrollCalls = [];
  const timers = [];
  const window = {
    scrollX: 17,
    scrollY: 29,
    scrollTo: (...coordinates) => scrollCalls.push(coordinates),
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    }
  };

  function makeNode(id, classNames = []) {
    const classes = new Set(classNames);
    return {
      id,
      children: [],
      focusCalls: [],
      parentElement: null,
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        contains: (name) => classes.has(name),
        remove: (...names) => names.forEach((name) => classes.delete(name))
      },
      append(...children) {
        children.forEach((child) => {
          child.parentElement = this;
          this.children.push(child);
        });
      },
      replaceChildren(...children) {
        this.children.forEach((child) => {
          child.parentElement = null;
        });
        this.children = [];
        this.append(...children);
      },
      closest(selector) {
        const className = selector.startsWith(".") ? selector.slice(1) : null;
        for (let current = this; current; current = current.parentElement) {
          if (className && current.classList?.contains(className)) {
            return current;
          }
        }
        return null;
      },
      contains(element) {
        for (let current = element; current; current = current.parentElement) {
          if (current === this) {
            return true;
          }
        }
        return false;
      },
      focus(options) {
        this.focusCalls.push(options);
        document.activeElement = this;
      },
      querySelector(selector) {
        const className = selector.startsWith(".") ? selector.slice(1) : null;
        const queue = [...this.children];
        while (queue.length > 0) {
          const candidate = queue.shift();
          if (className && candidate.classList.contains(className)) {
            return candidate;
          }
          queue.push(...candidate.children);
        }
        return null;
      }
    };
  }

  const projectsFallback = makeNode("projects-fallback");
  const fallbackCard = makeNode("project-techdb", ["projects-fallback-card"]);
  const fallbackPermalink = makeNode("", [
    "project-permalink",
    "projects-fallback-permalink"
  ]);
  const fallbackLinks = Object.fromEntries(
    ["primary", "secondary", "evidence"].map((variant) => [
      variant,
      makeNode("", ["project-link", `project-link--${variant}`])
    ])
  );
  fallbackCard.append(fallbackPermalink, ...Object.values(fallbackLinks));
  projectsFallback.append(fallbackCard);

  const projectsContainer = makeNode("projects-container");
  const projectsDirectory = makeNode("projects-directory");
  const dynamicCard = makeNode("project-techdb", ["project-row", "is-priming"]);
  const dynamicPermalink = makeNode("", ["project-permalink"]);
  const dynamicShare = makeNode("", ["project-share-button"]);
  const dynamicLinks = Object.fromEntries(
    ["primary", "secondary", "evidence"].map((variant) => [
      variant,
      makeNode("", ["project-link", `project-link--${variant}`])
    ])
  );
  dynamicCard.append(dynamicPermalink, dynamicShare, ...Object.values(dynamicLinks));
  projectsContainer.append(dynamicCard);
  const unobserved = [];
  document.getElementById = (id) => (id === dynamicCard.id ? dynamicCard : null);

  const {
    captureProjectCatalogueFocus,
    restoreProjectCatalogueFocus,
    shouldScheduleProjectFragmentFocusAfterRender
  } = vm.runInNewContext(
    `(() => { ${focusSource}; return {
      captureProjectCatalogueFocus,
      restoreProjectCatalogueFocus,
      shouldScheduleProjectFragmentFocusAfterRender
    }; })()`,
    {
      document,
      projectRevealObserver: {
        unobserve: (target) => unobserved.push(target.id)
      },
      projectsContainer,
      projectsDirectory,
      projectsFallback,
      window
    },
    { timeout: 1000 }
  );

  for (const [fallbackControl, dynamicControl, expectedSelector] of [
    [fallbackPermalink, dynamicPermalink, ".project-permalink"],
    [fallbackLinks.primary, dynamicLinks.primary, ".project-link--primary"],
    [fallbackLinks.secondary, dynamicLinks.secondary, ".project-link--secondary"],
    [fallbackLinks.evidence, dynamicLinks.evidence, ".project-link--evidence"]
  ]) {
    document.activeElement = fallbackControl;
    dynamicCard.classList.add("is-priming");
    const handoff = captureProjectCatalogueFocus();
    assert.equal(handoff.kind, "catalogue");
    assert.equal(handoff.projectId, "project-techdb");
    assert.equal(handoff.scrollX, 17);
    assert.equal(handoff.scrollY, 29);
    assert.equal(handoff.source, "fallback");
    assert.equal(handoff.targetSelector, expectedSelector);
    assert.equal(handoff.wasProjectTarget, false);
    assert.equal(restoreProjectCatalogueFocus(handoff), true);
    assert.equal(document.activeElement, dynamicControl);
    assert.equal(dynamicControl.focusCalls.at(-1).preventScroll, true);
    assert.equal(dynamicCard.classList.contains("is-priming"), false);
    assert.equal(shouldScheduleProjectFragmentFocusAfterRender(handoff), false);
    assert.deepEqual(scrollCalls.at(-1), [17, 29]);
  }

  document.activeElement = fallbackCard;
  const fragmentHandoff = captureProjectCatalogueFocus();
  assert.equal(fragmentHandoff.wasProjectTarget, true);
  assert.equal(restoreProjectCatalogueFocus(fragmentHandoff), true);
  assert.equal(document.activeElement, dynamicCard);
  assert.equal(dynamicCard.focusCalls.at(-1).preventScroll, true);
  assert.deepEqual(scrollCalls.at(-1), [17, 29]);
  assert.equal(shouldScheduleProjectFragmentFocusAfterRender(fragmentHandoff), true);

  const oldDynamicCard = makeNode("project-techdb", ["project-row"]);
  const oldDynamicPermalink = makeNode("", ["project-permalink"]);
  const oldDynamicShare = makeNode("", ["project-share-button"]);
  const oldDynamicLinks = Object.fromEntries(
    ["primary", "secondary", "evidence"].map((variant) => [
      variant,
      makeNode("", ["project-link", `project-link--${variant}`])
    ])
  );
  oldDynamicCard.append(
    oldDynamicPermalink,
    oldDynamicShare,
    ...Object.values(oldDynamicLinks)
  );
  for (const [oldControl, newControl, expectedSelector] of [
    [oldDynamicPermalink, dynamicPermalink, ".project-permalink"],
    [oldDynamicShare, dynamicShare, ".project-share-button"],
    [oldDynamicLinks.primary, dynamicLinks.primary, ".project-link--primary"],
    [oldDynamicLinks.secondary, dynamicLinks.secondary, ".project-link--secondary"],
    [oldDynamicLinks.evidence, dynamicLinks.evidence, ".project-link--evidence"]
  ]) {
    projectsContainer.replaceChildren(oldDynamicCard);
    document.activeElement = oldControl;
    const handoff = captureProjectCatalogueFocus();
    assert.equal(handoff.kind, "catalogue");
    assert.equal(handoff.source, "dynamic");
    assert.equal(handoff.targetSelector, expectedSelector);
    projectsContainer.replaceChildren(dynamicCard);
    assert.equal(restoreProjectCatalogueFocus(handoff), true);
    assert.equal(document.activeElement, newControl);
    assert.equal(newControl.focusCalls.at(-1).preventScroll, true);
    assert.equal(shouldScheduleProjectFragmentFocusAfterRender(handoff), false);
  }

  projectsContainer.replaceChildren(oldDynamicCard);
  document.activeElement = oldDynamicCard;
  const dynamicFragmentHandoff = captureProjectCatalogueFocus();
  projectsContainer.replaceChildren(dynamicCard);
  assert.equal(restoreProjectCatalogueFocus(dynamicFragmentHandoff), true);
  assert.equal(document.activeElement, dynamicCard);
  assert.deepEqual(scrollCalls.at(-1), [17, 29]);
  assert.equal(
    shouldScheduleProjectFragmentFocusAfterRender(dynamicFragmentHandoff),
    true
  );

  const oldDirectoryLink = makeNode("", ["project-directory-link"]);
  oldDirectoryLink.getAttribute = (name) =>
    name === "href" ? "#project-techdb" : null;
  const newDirectoryLink = makeNode("", ["project-directory-link"]);
  projectsDirectory.append(oldDirectoryLink);
  projectsDirectory.querySelector = (selector) =>
    selector === '.project-directory-link[href="#project-techdb"]'
      ? newDirectoryLink
      : null;
  document.activeElement = oldDirectoryLink;
  const directoryHandoff = captureProjectCatalogueFocus();
  assert.equal(directoryHandoff.kind, "catalogue");
  assert.equal(directoryHandoff.source, "directory");
  projectsDirectory.replaceChildren(newDirectoryLink);
  assert.equal(restoreProjectCatalogueFocus(directoryHandoff), true);
  assert.equal(document.activeElement, newDirectoryLink);
  assert.equal(newDirectoryLink.focusCalls.at(-1).preventScroll, true);
  assert.equal(shouldScheduleProjectFragmentFocusAfterRender(directoryHandoff), false);

  const outsideControl = makeNode("outside-control");
  const animationFrames = [];
  window.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  };
  document.activeElement = fallbackLinks.primary;
  const cancelledViewportHandoff = captureProjectCatalogueFocus();
  assert.equal(restoreProjectCatalogueFocus(cancelledViewportHandoff), true);
  assert.equal(animationFrames.length, 1);
  animationFrames.shift()();
  assert.equal(timers.length, 1);
  document.activeElement = outsideControl;
  const scrollCountBeforeCancelledFrame = scrollCalls.length;
  timers.shift()();
  assert.equal(scrollCalls.length, scrollCountBeforeCancelledFrame);

  document.activeElement = fallbackLinks.primary;
  const settledViewportHandoff = captureProjectCatalogueFocus();
  assert.equal(restoreProjectCatalogueFocus(settledViewportHandoff), true);
  animationFrames.shift()();
  const scrollCountBeforeSettledFrame = scrollCalls.length;
  timers.shift()();
  assert.equal(scrollCalls.length, scrollCountBeforeSettledFrame + 1);

  document.activeElement = outsideControl;
  const outsideHandoff = captureProjectCatalogueFocus();
  assert.equal(outsideHandoff.kind, "outside");
  assert.equal(restoreProjectCatalogueFocus(outsideHandoff), false);
  assert.equal(document.activeElement, outsideControl);
  assert.equal(shouldScheduleProjectFragmentFocusAfterRender(outsideHandoff), false);

  document.activeElement = document.body;
  const neutralHandoff = captureProjectCatalogueFocus();
  assert.equal(neutralHandoff.kind, "neutral");
  assert.equal(shouldScheduleProjectFragmentFocusAfterRender(neutralHandoff), true);
  assert.equal(unobserved.length, 13);
  assert.equal(scrollCalls.length, 15);
});

test("stalled and failed project loads preserve the fallback until retry recovery is validated", async () => {
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
  let nextTimerId = 0;
  let stalledSignal = null;
  const timers = new Map();
  const responses = [
    ({ signal }) => {
      stalledSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    },
    { ok: false, status: 503 },
    new TypeError("offline"),
    {
      ok: true,
      json: async () => {
        throw new SyntaxError("Malformed projects.json");
      }
    },
    { ok: true, json: async () => [{ invalid: true }] },
    { ok: true, json: async () => projects }
  ];
  const context = {
    AbortController,
    PROJECT_REQUEST_TIMEOUT_MS: 8_000,
    PROJECT_RUNTIME_READY_CLASS: "projects-runtime-ready",
    console: { error: (...args) => consoleErrors.push(args) },
    document: {
      createElement: (tagName) => new FakeElement(tagName),
      documentElement
    },
    fetch: async (_url, options) => {
      const response = responses.shift();
      if (typeof response === "function") {
        return response(options);
      }
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    projectLoadController: null,
    projectLoadSequence: 0,
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
    validateProject: (project) => {
      if (project.invalid) {
        throw new TypeError("Invalid project record");
      }
    },
    window: {
      clearTimeout: (timerId) => timers.delete(timerId),
      setTimeout(callback, delay) {
        const timerId = ++nextTimerId;
        timers.set(timerId, {
          delay,
          run() {
            timers.delete(timerId);
            callback();
          }
        });
        return timerId;
      },
      siteI18n
    }
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
    documentElement.classList.add(context.PROJECT_RUNTIME_READY_CLASS);
  };

  vm.runInNewContext(`${statusSource}\n${loadingSource}`, context, { timeout: 1000 });

  assert.equal(documentElement.classList.contains("projects-runtime-ready"), false);
  const stalledLoad = context.loadProjects();
  assert.equal(projectsContainer.getAttribute("aria-busy"), "true");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(timers.size, 1);
  const [requestTimeout] = timers.values();
  assert.equal(requestTimeout.delay, 8_000);
  requestTimeout.run();
  await stalledLoad;
  assert.equal(stalledSignal.aborted, true);
  assert.equal(timers.size, 0);
  assert.equal(documentElement.classList.contains("projects-runtime-ready"), false);
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
  const httpFailure = firstRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.children.length, 0);
  await httpFailure;
  assert.equal(projectsStatus.textContent, "Projects could not be loaded. Check your connection and try again.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsContainer.children.length, 1);
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsDirectory.hidden, true);
  assert.equal(projectsDirectory.children.length, 0);
  const recoveryRetry = projectsContainer.children[0].children[0];
  assert.equal(recoveryRetry.textContent, "Try again");

  const networkFailure = recoveryRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.children.length, 0);
  await networkFailure;
  assert.equal(projectsStatus.textContent, "Projects could not be loaded. Check your connection and try again.");
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsContainer.children.length, 1);

  const malformedRetry = projectsContainer.children[0].children[0];
  const malformedJson = malformedRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.children.length, 0);
  await malformedJson;
  assert.equal(projectsStatus.textContent, "Projects could not be loaded. Check your connection and try again.");
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsContainer.children.length, 1);

  const validationRetry = projectsContainer.children[0].children[0];
  const invalidCatalogue = validationRetry.click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.children.length, 0);
  await invalidCatalogue;
  assert.equal(projectsStatus.textContent, "Projects could not be loaded. Check your connection and try again.");
  assert.equal(projectsFallback.children.length, 9);
  assert.equal(projectsContainer.children.length, 1);

  const recovery = projectsContainer.children[0].children[0].click();
  assert.equal(projectsStatus.textContent, "Loading projects.");
  assert.equal(projectsFallback.classList.contains("is-visible"), true);
  assert.equal(projectsFallback.getAttribute("aria-hidden"), "false");
  assert.equal(projectsContainer.children.length, 0);
  await recovery;

  assert.equal(documentElement.classList.contains("projects-runtime-ready"), true);
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
  assert.equal(consoleErrors.length, 5);
  assert.equal(fragmentFocusCalls, 5);
  assert.equal(timers.size, 0);

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
  assert.ok(
    renderSource.indexOf("projectsContainer.replaceChildren(fragment)") <
      renderSource.indexOf("classList.add(PROJECT_RUNTIME_READY_CLASS)"),
    "Runtime ownership must begin only after enhanced targets enter the DOM"
  );
});

test("only the latest overlapping project request may commit its catalogue", async () => {
  const scriptSource = await readUtf8("script.js");
  const loadSource = sourceBetween(
    scriptSource,
    "async function loadProjects",
    'document.addEventListener("site-languagechange"'
  );
  const timers = new Map();
  const renderedSlugs = [];
  const consoleErrors = [];
  let fetchCalls = 0;
  let nextTimerId = 0;
  let resolveFirstRequest;
  let firstSignal;
  let staleJsonCalls = 0;
  const context = {
    AbortController,
    PROJECT_REQUEST_TIMEOUT_MS: 8_000,
    console: { error: (...args) => consoleErrors.push(args) },
    fetch: (_url, { signal }) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        firstSignal = signal;
        return new Promise((resolve) => {
          resolveFirstRequest = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [{ slug: "current" }]
      });
    },
    projectLoadController: null,
    projectLoadSequence: 0,
    projects: null,
    renderProjectError: () => {
      throw new Error("A stale request must not render an error.");
    },
    renderProjectLoading: () => {},
    renderProjects: () => renderedSlugs.push(context.projects[0].slug),
    validateProject: () => {},
    window: {
      clearTimeout: (timerId) => timers.delete(timerId),
      setTimeout(callback, delay) {
        const timerId = ++nextTimerId;
        timers.set(timerId, { callback, delay });
        return timerId;
      },
      siteI18n: {
        resolveSitePath: (value) => value
      }
    }
  };
  vm.runInNewContext(loadSource, context, { timeout: 1000 });

  const staleLoad = context.loadProjects();
  const currentLoad = context.loadProjects();
  await currentLoad;

  assert.equal(firstSignal.aborted, true);
  assert.equal(context.projects[0].slug, "current");
  assert.deepEqual(renderedSlugs, ["current"]);
  assert.equal(timers.size, 1, "Only the ignored first request timer should remain");

  resolveFirstRequest({
    ok: true,
    json: async () => {
      staleJsonCalls += 1;
      return [{ slug: "stale" }];
    }
  });
  await staleLoad;

  assert.equal(staleJsonCalls, 0, "Stale data must not reach parsing or validation");
  assert.equal(context.projects[0].slug, "current");
  assert.deepEqual(renderedSlugs, ["current"]);
  assert.equal(consoleErrors.length, 0);
  assert.equal(timers.size, 0);
});
