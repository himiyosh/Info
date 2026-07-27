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

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.hidden = false;
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
}

test("the enhanced directory stays empty without data and renders canonical localized links", async () => {
  const [indexHtml, scriptSource, i18nSource, stylesSource, projects] = await Promise.all([
    readUtf8("index.html"),
    readUtf8("script.js"),
    readUtf8("i18n.js"),
    readUtf8("styles.css"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  const directoryMarkup = indexHtml.match(
    /<nav\b[^>]*\bid="projects-directory"[^>]*>[\s\S]*?<\/nav>/i
  )?.[0];
  assert.ok(directoryMarkup, "The Projects introduction must include one directory surface");
  assert.match(directoryMarkup, /\bhidden\b/);
  assert.match(directoryMarkup, /data-i18n-aria-label="projects\.directoryLabel"/);
  assert.doesNotMatch(directoryMarkup, /<a\b/i, "No-JS markup must not expose dead fragments");
  assert.ok(
    indexHtml.indexOf('id="projects-directory"') < indexHtml.indexOf('id="projects-status"'),
    "The directory must stay beside the Projects introduction and before status/results"
  );

  assert.match(i18nSource, /directoryLabel:\s*"プロジェクト一覧"/);
  assert.match(i18nSource, /directoryLabel:\s*"Project directory"/);
  assert.match(
    stylesSource,
    /\.project-directory-link\s*\{[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/s
  );
  assert.match(
    stylesSource,
    /\.project-directory-title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s
  );
  assert.match(
    stylesSource,
    /@media \(min-width:\s*48rem\)[\s\S]*?\.project-directory-list\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\);/
  );

  const projectsDirectory = new FakeElement("nav");
  projectsDirectory.hidden = true;
  const language = { current: "ja" };
  const labels = {
    ja: "プロジェクト一覧",
    en: "Project directory"
  };
  const context = {
    document: {
      createElement: (tagName) => new FakeElement(tagName)
    },
    localizedValue: (value) => value[language.current],
    projectTargetId: (slug) => `project-${slug}`,
    projects,
    projectsDirectory,
    window: {
      siteI18n: {
        t: () => labels[language.current]
      }
    }
  };
  const directorySource = sourceBetween(
    scriptSource,
    "function clearProjectDirectory",
    "function renderProjects"
  );
  vm.runInNewContext(directorySource, context, { timeout: 1000 });

  context.renderProjectDirectory();
  assert.equal(projectsDirectory.hidden, false);
  assert.equal(projectsDirectory.getAttribute("aria-label"), labels.ja);
  const japaneseLinks = projectsDirectory.children[0].children.map(
    (item) => item.children[0]
  );
  assert.equal(japaneseLinks.length, 9);
  assert.deepEqual(
    japaneseLinks.map((link) => link.getAttribute("href")),
    projects.map((project) => `#project-${project.slug}`)
  );
  assert.deepEqual(
    japaneseLinks.map((link) => link.children[0].textContent),
    projects.map((project) => project.title.ja)
  );

  language.current = "en";
  context.renderProjectDirectory();
  const englishLinks = projectsDirectory.children[0].children.map(
    (item) => item.children[0]
  );
  assert.equal(projectsDirectory.getAttribute("aria-label"), labels.en);
  assert.deepEqual(
    englishLinks.map((link) => link.children[0].textContent),
    projects.map((project) => project.title.en)
  );
  assert.deepEqual(
    englishLinks.map((link) => link.getAttribute("href")),
    japaneseLinks.map((link) => link.getAttribute("href"))
  );

  context.clearProjectDirectory();
  assert.equal(projectsDirectory.hidden, true);
  assert.equal(projectsDirectory.children.length, 0);

  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );
  assert.ok(
    renderSource.indexOf("projectsContainer.replaceChildren(fragment)") <
      renderSource.indexOf("renderProjectDirectory()"),
    "Directory links must be exposed only after their card targets enter the DOM"
  );
  assert.match(
    sourceBetween(scriptSource, "function renderProjectLoading", "function renderProjectError"),
    /clearProjectDirectory\(\)/
  );
  assert.match(
    sourceBetween(scriptSource, "function renderProjectError", "async function loadProjects"),
    /clearProjectDirectory\(\)/
  );
});

test("one directory activation focuses the ninth card through the stable fragment contract", async () => {
  const scriptSource = await readUtf8("script.js");
  const fragmentSource = sourceBetween(
    scriptSource,
    "function projectFragmentTarget",
    "function updateProjectStatus"
  );
  const target = {
    id: "project-image-resizer",
    classList: {
      contains: (className) => className === "project-row",
      remove: () => {}
    },
    focusCalls: [],
    scrollCalls: [],
    focus(options) {
      this.focusCalls.push(options);
    },
    scrollIntoView(options) {
      this.scrollCalls.push(options);
    }
  };
  const location = { hash: "" };
  const context = {
    document: {
      getElementById: (id) => (id === target.id ? target : null)
    },
    prefersReducedMotion: false,
    projectRevealObserver: null,
    projectsContainer: {
      contains: (element) => element === target
    },
    queueMicrotask,
    window: {
      location,
      history: {
        state: null,
        pushState(_state, _title, hash) {
          location.hash = hash;
        }
      },
      siteI18n: {
        rememberInHistory: () => {},
        syncFromHistory: () => false
      }
    }
  };
  const { handleProjectPermalinkClick } = vm.runInNewContext(
    `(() => { ${fragmentSource}; return { handleProjectPermalinkClick }; })()`,
    context,
    { timeout: 1000 }
  );
  const link = {
    closest(selector) {
      assert.match(selector, /a\.project-directory-link/);
      return this;
    },
    getAttribute: () => "#project-image-resizer"
  };
  const event = {
    target: link,
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };

  handleProjectPermalinkClick(event);
  await Promise.resolve();
  assert.equal(event.defaultPrevented, true);
  assert.equal(location.hash, "#project-image-resizer");
  assert.equal(target.focusCalls.length, 1);
  assert.equal(target.focusCalls[0].preventScroll, true);
  assert.equal(target.scrollCalls.length, 1);
  assert.equal(target.scrollCalls[0].behavior, "smooth");
  assert.equal(target.scrollCalls[0].block, "start");
  assert.match(
    scriptSource,
    /projectsDirectory\.addEventListener\("click", handleProjectPermalinkClick\)/
  );
});
