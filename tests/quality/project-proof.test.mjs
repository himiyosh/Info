import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const proofProjectSlugs = new Set(["url-decoder", "image-resizer"]);

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

  add(...classNames) {
    classNames.forEach((className) => this.values.add(className));
  }

  contains(className) {
    return this.values.has(className);
  }

  remove(...classNames) {
    classNames.forEach((className) => this.values.delete(className));
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.className = "";
    this.dataset = {};
    this.hidden = false;
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value))
    };
    this.textContent = "";
  }

  append(...children) {
    for (const child of children) {
      if (child?.tagName === "#document-fragment") {
        this.children.push(...child.children);
      } else {
        this.children.push(child);
      }
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  querySelectorAll(selector) {
    assert.match(selector, /^\.[a-z0-9-]+$/i);
    const className = selector.slice(1);
    const matches = [];
    const visit = (element) => {
      if (!(element instanceof FakeElement)) {
        return;
      }
      const declaredClasses = element.className.split(/\s+/).filter(Boolean);
      if (declaredClasses.includes(className) || element.classList.contains(className)) {
        matches.push(element);
      }
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

function findById(root, id) {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    if (child instanceof FakeElement) {
      const match = findById(child, id);
      if (match) {
        return match;
      }
    }
  }
  return null;
}

test("URLDecoder and ImageResizer render their exact localized proof and immutable citation", async () => {
  const [scriptSource, catalogue] = await Promise.all([
    readUtf8("script.js"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  const projects = catalogue.filter(({ slug }) => proofProjectSlugs.has(slug));
  assert.deepEqual(projects.map(({ slug }) => slug), [...proofProjectSlugs]);

  const rendererSource = [
    sourceBetween(scriptSource, "function localizedValue", "function validateLocalizedField"),
    sourceBetween(scriptSource, "function createProjectAction", "// --- Motion: bounded"),
    sourceBetween(scriptSource, "function renderProjects", "function renderProjectLoading")
  ].join("\n");
  const currentLanguage = { value: "ja" };
  const projectsContainer = new FakeElement("div");
  const projectsFallback = new FakeElement("div");
  projectsFallback.append(new FakeElement("article"));
  const labels = {
    ja: {
      "accessibility.opensInNewTab": "（新しいタブで開きます）",
      "projects.permalinkAction": "固定リンク",
      "projects.permalinkLabel": "「{title}」プロジェクトへの固定リンク",
      "projects.shareAction": "共有",
      "projects.shareLabel": "「{title}」プロジェクトを共有",
      "projects.proofAction": "根拠を見る",
      "projects.proofLabel": "公開根拠",
      "projects.ready": "{count}件のプロジェクトを表示しました。"
    },
    en: {
      "accessibility.opensInNewTab": " (opens in a new tab)",
      "projects.permalinkAction": "Permalink",
      "projects.permalinkLabel": "Permalink to the {title} project",
      "projects.shareAction": "Share",
      "projects.shareLabel": "Share the {title} project",
      "projects.proofAction": "View evidence",
      "projects.proofLabel": "Public evidence",
      "projects.ready": "{count} projects loaded."
    }
  };
  const context = {
    document: {
      createDocumentFragment: () => new FakeElement("#document-fragment"),
      createElement: (tagName) => new FakeElement(tagName),
      documentElement: { classList: new FakeClassList() }
    },
    PROJECT_RUNTIME_READY_CLASS: "projects-runtime-ready",
    projectPreviewDesktopMedia: "(min-width: 48rem)",
    projectPreviewMobileMedia: "(max-width: 47.999rem)",
    projectRevealObserver: null,
    projectRows: [],
    projectShareControllers: [],
    projects,
    projectsContainer,
    projectsFallback,
    projectTargetId: (slug) => `project-${slug}`,
    createProjectShareController: () => ({ reset() {} }),
    resetProjectShareControllers: () => {},
    refreshScrollScenes: () => {},
    renderProjectDirectory: () => {},
    requestScrollMotionUpdate: () => {},
    scheduleProjectFragmentFocus: () => {},
    shouldAnimateProjectReveal: () => false,
    updateProjectStatus: () => {},
    writeTextToClipboard: async () => true,
    window: {
      setTimeout: () => {},
      siteI18n: {
        get language() {
          return currentLanguage.value;
        },
        resolveSitePath: (relativePath) => relativePath,
        t: (key) => labels[currentLanguage.value][key]
      }
    }
  };
  const renderProjects = vm.runInNewContext(
    `(() => { ${rendererSource}; return renderProjects; })()`,
    context,
    { timeout: 1000 }
  );

  for (const language of ["ja", "en"]) {
    currentLanguage.value = language;
    renderProjects();
    assert.equal(projectsContainer.children.length, projects.length);
    assert.equal(projectsFallback.children.length, 0);

    for (const project of projects) {
      const article = findById(projectsContainer, `project-${project.slug}`);
      assert.ok(article, `${project.slug} must render a project card`);
      const proof = article.querySelectorAll(".project-proof")[0];
      assert.ok(proof, `${project.slug} must render its proof surface`);
      const [proofText, proofLink] = proof.children;
      const [proofLabel, proofStatement] = proofText.children;
      assert.equal(proofLabel.textContent, labels[language]["projects.proofLabel"]);
      assert.equal(proofStatement.textContent, project.proof[language]);
      assert.equal(proofLink.href, project.proofLink);
      assert.equal(proofLink.target, "_blank");
      assert.equal(proofLink.rel, "noopener noreferrer");
      assert.equal(proofLink.children[0].textContent, labels[language]["projects.proofAction"]);
    }
  }
});
