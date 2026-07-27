import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const expectedSlugs = [
  "portfolio",
  "techdb",
  "jojo-aiagent",
  "jojo-git",
  "ucfitness",
  "encode-decode-tool",
  "network-plus",
  "url-decoder",
  "image-resizer"
];
const topLevelIds = new Set(["top", "about", "projects", "contact", "main-content"]);

function sourceBetween(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return sourceText.slice(start, end);
}

function makeTarget(id) {
  const classes = new Set(["project-row", "is-priming"]);
  return {
    id,
    classes,
    focusCalls: [],
    scrollCalls: [],
    classList: {
      contains: (className) => classes.has(className),
      remove: (className) => classes.delete(className)
    },
    focus(options) {
      this.focusCalls.push(options);
    },
    scrollIntoView(options) {
      this.scrollCalls.push(options);
    }
  };
}

function makeClickEvent(link, overrides = {}) {
  return {
    target: link,
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...overrides
  };
}

test("project catalogue exposes the exact nine stable slug and fragment IDs", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const indexHtml = await readUtf8("index.html");
  const slugs = projects.map((project) => project.slug);
  const fragmentIds = slugs.map((slug) => `project-${slug}`);
  const staticIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  assert.deepEqual(slugs, expectedSlugs);
  assert.equal(new Set(slugs).size, expectedSlugs.length);
  assert.equal(new Set(fragmentIds).size, expectedSlugs.length);
  for (const [index, slug] of slugs.entries()) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!topLevelIds.has(slug), `Slug must not reuse top-level ID: ${slug}`);
    assert.ok(!staticIds.has(fragmentIds[index]), `Fragment ID must not collide: ${fragmentIds[index]}`);
  }
});

test("runtime slug validation rejects empty, invalid, reserved, and duplicate values", async () => {
  const scriptSource = await readUtf8("script.js");
  const slugSource = sourceBetween(
    scriptSource,
    "function projectTargetId",
    "function githubRepositoryKey"
  );
  const { projectTargetId, validateStableSlug } = vm.runInNewContext(
    `(() => { ${slugSource}; return { projectTargetId, validateStableSlug }; })()`,
    {
      projectSlugPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      reservedProjectSlugs: new Set(topLevelIds),
      requireNonEmptyString(value, fieldName) {
        if (typeof value !== "string" || value.trim() === "") {
          throw new TypeError(`${fieldName} must be a non-empty string.`);
        }
        return value.trim();
      }
    },
    { timeout: 1000 }
  );

  const seenSlugs = new Set();
  assert.equal(validateStableSlug({ slug: "portfolio" }, 0, seenSlugs), "portfolio");
  assert.equal(projectTargetId("portfolio"), "project-portfolio");
  assert.throws(
    () => validateStableSlug({}, 0, new Set()),
    /slug.*non-empty string/
  );
  assert.throws(
    () => validateStableSlug({ slug: " " }, 0, new Set()),
    /slug.*non-empty string/
  );
  for (const invalidSlug of [
    "Portfolio",
    "portfolio_site",
    "-portfolio",
    "portfolio-",
    "portfolio--site",
    " portfolio"
  ]) {
    assert.throws(
      () => validateStableSlug({ slug: invalidSlug }, 0, new Set()),
      /lowercase kebab-case/
    );
  }
  for (const reservedSlug of topLevelIds) {
    assert.throws(
      () => validateStableSlug({ slug: reservedSlug }, 0, new Set()),
      /slug.*reserved/
    );
  }
  assert.throws(
    () => validateStableSlug({ slug: "portfolio" }, 1, seenSlugs),
    /Duplicate project slug/
  );
  assert.match(
    scriptSource,
    /validateStableSlug\(project, index, seenSlugs\)/
  );
  assert.match(
    scriptSource,
    /const seenSlugs = new Set\(\);[\s\S]*validateProject\(\s*project,\s*index,\s*seenSlugs,/
  );
});

test("project renderer emits localized focusable same-page permalinks without changing actions", async () => {
  const scriptSource = await readUtf8("script.js");
  const i18nSource = await readUtf8("i18n.js");
  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );

  assert.match(renderSource, /article\.id = projectTargetId\(project\.slug\)/);
  assert.match(renderSource, /article\.tabIndex = -1/);
  assert.match(renderSource, /title\.id = `\$\{article\.id\}-title`/);
  assert.match(renderSource, /permalink\.setAttribute\("href", `#\$\{article\.id\}`\)/);
  assert.match(
    renderSource,
    /window\.siteI18n\.t\("projects\.permalinkLabel"\)\.replace\("\{title\}", localizedTitle\)/
  );
  assert.match(
    renderSource,
    /permalink\.textContent = window\.siteI18n\.t\("projects\.permalinkAction"\)/
  );
  assert.match(renderSource, /headingLine\.append\(title, permalink\)/);
  assert.doesNotMatch(
    sourceBetween(renderSource, 'permalink.className = "project-permalink"', "kind.className"),
    /\.target\s*=|target="_blank"/
  );
  assert.match(i18nSource, /permalinkAction:\s*"固定リンク"/);
  assert.match(i18nSource, /permalinkLabel:\s*"「\{title\}」プロジェクトへの固定リンク"/);
  assert.match(i18nSource, /permalinkAction:\s*"Permalink"/);
  assert.match(i18nSource, /permalinkLabel:\s*"Permalink to the \{title\} project"/);

  assert.match(renderSource, /actions\.append\(primaryLink\)/);
  assert.match(renderSource, /actions\.append\(sourceLink\)/);
  assert.match(renderSource, /content\.append\(headingGroup, details, actions\)/);
  assert.match(renderSource, /content\.append\(proof\)/);
});

test("project fragment focus handles cold render, click history, back-forward, and reduced motion", async () => {
  const scriptSource = await readUtf8("script.js");
  const fragmentSource = sourceBetween(
    scriptSource,
    "function projectFragmentTarget",
    "function updateProjectStatus"
  );
  const portfolioTarget = makeTarget("project-portfolio");
  const techdbTarget = makeTarget("project-techdb");
  const targets = new Map([
    [portfolioTarget.id, portfolioTarget],
    [techdbTarget.id, techdbTarget]
  ]);
  const links = new Set();
  const projectsContainer = {
    contains: (element) => targets.has(element.id) || links.has(element)
  };
  const location = { hash: "#project-portfolio" };
  const historyEntries = [""];
  let historyIndex = 0;
  const observedTargets = [];
  const context = {
    queueMicrotask,
    document: {
      getElementById: (id) => targets.get(id) ?? null
    },
    projectsContainer,
    projectRevealObserver: {
      unobserve: (target) => observedTargets.push(target.id)
    },
    prefersReducedMotion: false,
    window: {
      location,
      siteI18n: {
        rememberInHistory: () => {},
        syncFromHistory: () => false
      },
      history: {
        state: null,
        pushState(_state, _title, hash) {
          historyEntries.splice(historyIndex + 1);
          historyEntries.push(hash);
          historyIndex = historyEntries.length - 1;
          location.hash = hash;
        }
      }
    }
  };
  const {
    focusProjectFragment,
    handleProjectPermalinkClick,
    handleProjectHashChange,
    handleProjectHistoryChange
  } = vm.runInNewContext(
    `(() => { ${fragmentSource}; return {
      focusProjectFragment,
      handleProjectPermalinkClick,
      handleProjectHashChange,
      handleProjectHistoryChange
    }; })()`,
    context,
    { timeout: 1000 }
  );

  assert.equal(focusProjectFragment(), true);
  assert.equal(portfolioTarget.focusCalls.length, 1);
  assert.equal(portfolioTarget.focusCalls[0].preventScroll, true);
  assert.equal(portfolioTarget.scrollCalls.length, 1);
  assert.equal(portfolioTarget.scrollCalls[0].behavior, "smooth");
  assert.equal(portfolioTarget.scrollCalls[0].block, "start");
  assert.ok(!portfolioTarget.classes.has("is-priming"));
  assert.deepEqual(observedTargets, ["project-portfolio"]);

  const portfolioLink = {
    closest: () => portfolioLink,
    getAttribute: () => "#project-portfolio"
  };
  const techdbLink = {
    closest: () => techdbLink,
    getAttribute: () => "#project-techdb"
  };
  links.add(portfolioLink);
  links.add(techdbLink);

  location.hash = "";
  const portfolioClick = makeClickEvent(portfolioLink);
  handleProjectPermalinkClick(portfolioClick);
  await Promise.resolve();
  assert.equal(portfolioClick.defaultPrevented, true);
  assert.equal(location.hash, "#project-portfolio");

  const techdbClick = makeClickEvent(techdbLink);
  handleProjectPermalinkClick(techdbClick);
  await Promise.resolve();
  assert.equal(techdbClick.defaultPrevented, true);
  assert.equal(location.hash, "#project-techdb");
  assert.equal(historyEntries.length, 3);

  historyIndex -= 1;
  location.hash = historyEntries[historyIndex];
  handleProjectHistoryChange({ state: { infoLanguage: "en" } });
  handleProjectHashChange();
  await Promise.resolve();
  assert.equal(location.hash, "#project-portfolio");
  assert.equal(portfolioTarget.focusCalls.length, 3);

  historyIndex += 1;
  location.hash = historyEntries[historyIndex];
  handleProjectHistoryChange({ state: { infoLanguage: "en" } });
  handleProjectHashChange();
  await Promise.resolve();
  assert.equal(location.hash, "#project-techdb");
  assert.equal(techdbTarget.focusCalls.length, 2);

  context.prefersReducedMotion = true;
  focusProjectFragment("#project-techdb");
  assert.equal(techdbTarget.scrollCalls.at(-1).behavior, "auto");
  assert.equal(techdbTarget.scrollCalls.at(-1).block, "start");

  const focusCount = portfolioTarget.focusCalls.length + techdbTarget.focusCalls.length;
  for (const hash of [
    "#top",
    "#about",
    "#projects",
    "#contact",
    "#project-missing",
    "#project-%"
  ]) {
    assert.equal(focusProjectFragment(hash), false);
  }
  assert.equal(
    portfolioTarget.focusCalls.length + techdbTarget.focusCalls.length,
    focusCount,
    "Unknown and non-project hashes must not move focus"
  );

  const modifiedClick = makeClickEvent(techdbLink, { metaKey: true });
  handleProjectPermalinkClick(modifiedClick);
  assert.equal(modifiedClick.defaultPrevented, false);

  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );
  assert.ok(
    renderSource.indexOf("projectsContainer.replaceChildren(fragment)") <
      renderSource.lastIndexOf("scheduleProjectFragmentFocus()"),
    "The initial hash must be resolved only after async project rows enter the DOM"
  );
  assert.equal(
    [...scriptSource.matchAll(/projectsContainer\.addEventListener\("click"/g)].length,
    1,
    "Permalinks must use one delegated click listener"
  );
  assert.equal(
    [...scriptSource.matchAll(/window\.addEventListener\("hashchange"/g)].length,
    1,
    "History traversal must use one hashchange listener"
  );
  assert.match(
    scriptSource,
    /function handleProjectHashChange\(\)\s*\{\s*window\.siteI18n\.rememberInHistory\(\);/
  );
  assert.equal(
    [...scriptSource.matchAll(/window\.addEventListener\("popstate"/g)].length,
    1,
    "History entries that also change language must use one popstate listener"
  );
});

test("language rerenders preserve the fragment and project focus contract", async () => {
  const scriptSource = await readUtf8("script.js");
  const i18nSource = await readUtf8("i18n.js");
  const languageHandler = sourceBetween(
    scriptSource,
    'document.addEventListener("site-languagechange"',
    'projectsContainer.addEventListener("click"'
  );
  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );
  const updateLanguageUrl = sourceBetween(
    i18nSource,
    "function updateLanguageUrl",
    "function updateTextContent"
  );

  assert.match(languageHandler, /projectState === "ready"[\s\S]*renderProjects\(\)/);
  assert.match(renderSource, /scheduleProjectFragmentFocus\(\);\s*\}/);
  assert.match(
    updateLanguageUrl,
    /`\$\{url\.pathname\}\$\{url\.search\}\$\{url\.hash\}`/
  );
  assert.doesNotMatch(languageHandler, /location\.hash\s*=|pushState/);
  assert.match(
    i18nSource,
    /syncFromHistory:\s*syncLanguageFromHistory/
  );
  assert.match(
    i18nSource,
    /rememberInHistory:\s*rememberLanguageInHistory/
  );
});

test("history traversal restores each permalink entry's language without changing its hash", async () => {
  const i18nSource = await readUtf8("i18n.js");
  const listeners = new Map();
  const languageEvents = [];
  let currentUrl = new URL("https://example.test/?lang=en#project-techdb");
  const location = {};
  const syncLocation = (url) => {
    currentUrl = new URL(url, currentUrl);
    for (const property of ["href", "pathname", "search", "hash"]) {
      location[property] = currentUrl[property];
    }
  };
  syncLocation(currentUrl);

  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      syncLocation(url);
    }
  };
  const document = {
    documentElement: { lang: "ja" },
    title: "",
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent: (event) => languageEvents.push(event)
  };
  class FakeCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  }
  const window = {
    location,
    history,
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    }
  };

  vm.runInNewContext(
    i18nSource,
    {
      window,
      document,
      URL,
      URLSearchParams,
      CustomEvent: FakeCustomEvent,
      console
    },
    { timeout: 1000 }
  );
  listeners.get("DOMContentLoaded")();
  assert.equal(window.siteI18n.language, "en");
  assert.equal(history.state.infoLanguage, "en");
  assert.equal(location.hash, "#project-techdb");

  window.siteI18n.toggle();
  assert.equal(window.siteI18n.language, "ja");
  assert.equal(history.state.infoLanguage, "ja");
  assert.equal(location.search, "");
  assert.equal(location.hash, "#project-techdb");

  history.state = null;
  syncLocation("https://example.test/#projects");
  window.siteI18n.rememberInHistory();
  assert.equal(history.state.infoLanguage, "ja");
  assert.equal(location.hash, "#projects");

  syncLocation("https://example.test/?lang=en#project-portfolio");
  assert.equal(window.siteI18n.syncFromHistory({ infoLanguage: "en" }), true);
  assert.equal(window.siteI18n.language, "en");
  assert.equal(history.state.infoLanguage, "en");
  assert.equal(location.search, "?lang=en");
  assert.equal(location.hash, "#project-portfolio");

  const eventCount = languageEvents.length;
  assert.equal(window.siteI18n.syncFromHistory({ infoLanguage: "en" }), false);
  assert.equal(languageEvents.length, eventCount);

  syncLocation("https://example.test/#project-jojo-git");
  assert.equal(window.siteI18n.syncFromHistory({ infoLanguage: "ja" }), true);
  assert.equal(window.siteI18n.language, "ja");
  assert.equal(location.search, "");
  assert.equal(location.hash, "#project-jojo-git");
});

test("permalink and target styles preserve focus, touch size, and responsive overflow", async () => {
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");
  const permalinkRule = stylesSource.match(/\.project-permalink\s*\{([^}]*)\}/s)?.[1];
  const headingLineRule = stylesSource.match(/\.project-heading-line\s*\{([^}]*)\}/s)?.[1];

  assert.ok(permalinkRule, "Expected a project permalink style");
  assert.match(permalinkRule, /max-width:\s*100%/);
  assert.match(permalinkRule, /min-width:\s*44px/);
  assert.match(permalinkRule, /min-height:\s*44px/);
  assert.match(permalinkRule, /display:\s*inline-flex/);
  assert.match(permalinkRule, /white-space:\s*nowrap/);
  assert.ok(headingLineRule, "Expected a wrapping title/permalink row");
  assert.match(headingLineRule, /min-width:\s*0/);
  assert.match(headingLineRule, /flex-wrap:\s*wrap/);
  assert.match(
    stylesSource,
    /\.project-row\s*\{[^}]*scroll-margin-block-start:\s*calc\(/s
  );
  assert.match(
    stylesSource,
    /\.project-row:target,\s*\.project-row:focus\s*\{[^}]*outline:\s*3px solid var\(--color-focus\);[^}]*outline-offset:\s*-3px;/s
  );
  assert.match(
    stylesSource,
    /:where\(a, button\):focus-visible\s*\{\s*outline:\s*3px solid var\(--color-focus\);/
  );
  assert.match(stylesSource, /html\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(stylesSource, /body\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(
    stylesSource,
    /@media \(min-width:\s*48rem\)[\s\S]*\.project-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s*minmax\(0,\s*1\.1fr\);/
  );
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.project-permalink\s*\{?[\s\S]*transform:\s*none !important;/
  );
  assert.match(
    modernSource,
    /\.project-permalink\s*\{[^}]*color:\s*var\(--color-ink-2\);[^}]*border-color:\s*var\(--color-rule\);/s
  );
});
