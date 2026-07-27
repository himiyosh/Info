import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function helperApi(source) {
  const helperEnd = source.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.notEqual(helperEnd, -1, "Project share helpers must precede DOM initialization");
  return vm.runInNewContext(
    `(() => {
      ${source.slice(0, helperEnd)}
      return {
        PROJECT_SHARE_STATUS_KEYS,
        createProjectShareController,
        createStableProjectShareUrl,
        shareProjectLink,
        writeTextToClipboard
      };
    })()`,
    {
      URL,
      document: {},
      window: {}
    },
    { timeout: 1000 }
  );
}

function sourceBetween(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return sourceText.slice(start, end);
}

class FakeElement {
  constructor(ownerDocument) {
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = true;
    this.listeners = new Map();
    this.ownerDocument = ownerDocument;
    this.textHistory = [];
    this.focusCalls = [];
    this._textContent = "";
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.textHistory.push(this._textContent);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
  }

  click() {
    return this.listeners.get("click")?.();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createControllerHarness(api, {
  language = "ja",
  title = language === "ja" ? "TechDB" : "TechDB",
  url = language === "ja"
    ? "https://himiyosh.github.io/Info/#project-techdb"
    : "https://himiyosh.github.io/Info/en/#project-techdb",
  share = null,
  copyText = async () => true
} = {}) {
  const document = { activeElement: null };
  const button = new FakeElement(document);
  const permalink = new FakeElement(document);
  const status = new FakeElement(document);
  const scheduled = [];
  let currentLanguage = language;
  const controller = api.createProjectShareController({
    title,
    button,
    permalink,
    status,
    getUrl: () => url,
    share,
    copyText,
    translate: (key) =>
      key.split(".").reduce((value, part) => value?.[part], translations[currentLanguage]),
    schedule: (callback) => scheduled.push(callback)
  });

  return {
    button,
    controller,
    document,
    flush() {
      scheduled.splice(0).forEach((callback) => callback());
    },
    permalink,
    setLanguage(nextLanguage) {
      currentLanguage = nextLanguage;
    },
    status,
    title,
    url
  };
}

test("stable share URLs keep the exact language route and fragment while dropping every query", async () => {
  const api = helperApi(await readUtf8("script.js"));

  assert.equal(
    api.createStableProjectShareUrl(
      "#project-techdb",
      "https://himiyosh.github.io/Info/?utm_source=test&lang=ja#project-portfolio"
    ),
    "https://himiyosh.github.io/Info/#project-techdb"
  );
  assert.equal(
    api.createStableProjectShareUrl(
      "#project-techdb",
      "https://himiyosh.github.io/Info/en/?ref=share&campaign=summer"
    ),
    "https://himiyosh.github.io/Info/en/#project-techdb"
  );
  assert.throws(
    () => api.createStableProjectShareUrl("#contact", "https://example.test/Info/"),
    /stable project fragment/
  );
});

test("native share receives the localized title and exact URL, keeps focus, and re-announces", async () => {
  const api = helperApi(await readUtf8("script.js"));
  const payloads = [];
  const copiedValues = [];
  const harness = createControllerHarness(api, {
    share: async (payload) => payloads.push(payload),
    copyText: async (value) => copiedValues.push(value)
  });

  harness.button.focus();
  await harness.button.click();
  harness.flush();
  await harness.button.click();
  harness.flush();

  assert.deepEqual(
    payloads.map(({ title, url }) => ({ title, url })),
    [
      { title: harness.title, url: harness.url },
      { title: harness.title, url: harness.url }
    ]
  );
  assert.deepEqual(copiedValues, []);
  assert.equal(harness.document.activeElement, harness.button);
  assert.equal(harness.permalink.focusCalls.length, 0);
  assert.equal(harness.button.dataset.shareState, "success");
  assert.equal(harness.button.getAttribute("aria-busy"), undefined);
  assert.equal(harness.status.textContent, translations.ja.projects.shareSuccess);
  assert.equal(
    harness.status.textHistory.filter(
      (value) => value === translations.ja.projects.shareSuccess
    ).length,
    2
  );
});

test("missing native share falls back to secure clipboard copy with the exact URL", async () => {
  const api = helperApi(await readUtf8("script.js"));
  const copiedValues = [];
  const harness = createControllerHarness(api, {
    copyText: async (value) => {
      copiedValues.push(value);
      return true;
    }
  });

  harness.button.focus();
  await harness.button.click();
  harness.flush();

  assert.deepEqual(copiedValues, [harness.url]);
  assert.equal(harness.status.textContent, translations.ja.projects.copySuccess);
  assert.equal(harness.document.activeElement, harness.button);
  assert.equal(harness.permalink.focusCalls.length, 0);
});

test("AbortError is neutral while non-cancellation share failure focuses the permalink", async () => {
  const api = helperApi(await readUtf8("script.js"));
  let clipboardCalls = 0;
  const cancelled = createControllerHarness(api, {
    share: async () => {
      throw { name: "AbortError" };
    },
    copyText: async () => {
      clipboardCalls += 1;
      return true;
    }
  });

  cancelled.button.focus();
  await cancelled.button.click();
  cancelled.flush();

  assert.equal(clipboardCalls, 0);
  assert.equal(cancelled.button.dataset.shareState, "idle");
  assert.equal(cancelled.button.getAttribute("aria-busy"), undefined);
  assert.equal(cancelled.status.textContent, "");
  assert.equal(cancelled.document.activeElement, cancelled.button);
  assert.equal(cancelled.permalink.focusCalls.length, 0);

  const rejected = createControllerHarness(api, {
    share: async () => {
      throw new Error("NotAllowedError: native share rejected");
    },
    copyText: async () => {
      clipboardCalls += 1;
      return true;
    }
  });
  rejected.button.focus();
  await rejected.button.click();
  rejected.flush();

  assert.equal(clipboardCalls, 0, "A supported but rejected share must not change channels");
  assert.equal(rejected.button.dataset.shareState, "error");
  assert.equal(rejected.document.activeElement, rejected.permalink);
  assert.deepEqual(
    rejected.permalink.focusCalls.map(({ preventScroll }) => ({ preventScroll })),
    [{ preventScroll: true }]
  );
  assert.equal(rejected.status.textContent, translations.ja.projects.shareFailure);
  assert.doesNotMatch(rejected.status.textContent, /NotAllowedError/);
});

test("unavailable or rejected clipboard focuses the permalink with localized guidance", async () => {
  const api = helperApi(await readUtf8("script.js"));

  for (const copyText of [
    async () => false,
    async () => {
      throw new Error("NotAllowedError: clipboard rejected");
    }
  ]) {
    const harness = createControllerHarness(api, { copyText });
    harness.button.focus();
    await assert.doesNotReject(() => harness.button.click());
    harness.flush();

    assert.equal(harness.button.dataset.shareState, "error");
    assert.equal(harness.document.activeElement, harness.permalink);
    assert.deepEqual(
      harness.permalink.focusCalls.map(({ preventScroll }) => ({ preventScroll })),
      [{ preventScroll: true }]
    );
    assert.equal(harness.status.textContent, translations.ja.projects.shareFailure);
  }
});

test("overlapping activations ignore an older failure after the latest success", async () => {
  const api = helperApi(await readUtf8("script.js"));
  const firstShare = deferred();
  const secondShare = deferred();
  const shares = [firstShare, secondShare];
  const harness = createControllerHarness(api, {
    share: () => shares.shift().promise
  });

  harness.button.focus();
  const firstActivation = harness.button.click();
  const secondActivation = harness.button.click();
  assert.equal(harness.button.dataset.shareState, "loading");
  assert.equal(harness.button.getAttribute("aria-busy"), "true");

  secondShare.resolve();
  await secondActivation;
  harness.flush();
  assert.equal(harness.status.textContent, translations.ja.projects.shareSuccess);

  firstShare.reject(new Error("stale native share rejection"));
  await firstActivation;
  harness.flush();

  assert.equal(harness.status.textContent, translations.ja.projects.shareSuccess);
  assert.equal(harness.button.dataset.shareState, "success");
  assert.equal(harness.permalink.focusCalls.length, 0);
  assert.equal(
    harness.status.textHistory.filter(
      (value) => value === translations.ja.projects.shareSuccess
    ).length,
    1
  );
});

test("controller reset invalidates pending work and the rerender path rebuilds localized controls", async () => {
  const [scriptSource, projects] = await Promise.all([
    readUtf8("script.js"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  const api = helperApi(scriptSource);
  const pendingShare = deferred();
  const japanese = createControllerHarness(api, {
    share: () => pendingShare.promise
  });

  const pendingActivation = japanese.button.click();
  japanese.controller.reset();
  pendingShare.resolve();
  await pendingActivation;
  japanese.flush();
  assert.equal(japanese.button.dataset.shareState, "idle");
  assert.equal(japanese.status.textContent, "");

  const englishPayloads = [];
  const english = createControllerHarness(api, {
    language: "en",
    share: async (payload) => englishPayloads.push(payload)
  });
  await english.button.click();
  english.flush();
  assert.deepEqual(
    englishPayloads.map(({ title, url }) => ({ title, url })),
    [{ title: english.title, url: english.url }]
  );
  assert.equal(english.status.textContent, translations.en.projects.shareSuccess);

  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );
  const languageHandler = sourceBetween(
    scriptSource,
    'document.addEventListener("site-languagechange"',
    'projectsDirectory.addEventListener("click"'
  );
  assert.match(renderSource, /resetProjectShareControllers\(\{ discard: true \}\)/);
  assert.match(languageHandler, /projectState === "ready"[\s\S]*renderProjects\(\)/);
  assert.match(
    renderSource,
    /shareButton\.textContent = window\.siteI18n\.t\("projects\.shareAction"\)/
  );
  assert.equal(projects.length, 9);
});

test("renderer keeps every permalink primary and adds one scoped progressive share action per card", async () => {
  const [scriptSource, i18nSource, template, japanesePage, englishPage, projects] =
    await Promise.all([
      readUtf8("script.js"),
      readUtf8("i18n.js"),
      readUtf8("templates/index.html"),
      readUtf8("index.html"),
      readUtf8("en/index.html"),
      readUtf8("projects.json").then(JSON.parse)
    ]);
  const renderSource = sourceBetween(
    scriptSource,
    "function renderProjects",
    "function renderProjectLoading"
  );

  assert.equal(projects.length, 9);
  assert.match(renderSource, /permalink\.setAttribute\("href", `#\$\{article\.id\}`\)/);
  assert.match(renderSource, /headingActions\.append\(permalink, shareButton\)/);
  assert.match(renderSource, /headingLine\.append\(title, headingActions\)/);
  assert.match(renderSource, /shareButton\.hidden = true/);
  assert.match(renderSource, /shareStatus\.id = `\$\{article\.id\}-share-status`/);
  assert.match(renderSource, /shareStatus\.setAttribute\("aria-live", "polite"\)/);
  assert.match(renderSource, /shareStatus\.setAttribute\("aria-atomic", "true"\)/);
  assert.match(renderSource, /shareButton\.setAttribute\("aria-describedby", shareStatus\.id\)/);
  assert.match(renderSource, /createProjectShareController\(\{/);
  assert.doesNotMatch(
    sourceBetween(renderSource, 'permalink.className = "project-permalink"', "kind.className"),
    /permalink\.addEventListener|permalink\.target|target="_blank"/
  );

  for (const source of [template, japanesePage, englishPage]) {
    assert.doesNotMatch(source, /class="project-share-button"/);
  }
  assert.match(i18nSource, /shareAction:\s*"共有"/);
  assert.match(i18nSource, /shareAction:\s*"Share"/);
  assert.match(i18nSource, /shareFailure:[\s\S]*固定リンクのコンテキストメニュー/);
  assert.match(i18nSource, /shareFailure:[\s\S]*permalink's context menu/);
});

test("share controls preserve 44px targets, one-line containment, and reduced-motion stability", async () => {
  const [styles, modern] = await Promise.all([
    readUtf8("styles.css"),
    readUtf8("modern.css")
  ]);
  const buttonRule = styles.match(/\.project-share-button\s*\{([^}]*)\}/s)?.[1] ?? "";
  const controlsRule =
    styles.match(/\.project-heading-actions\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(buttonRule, /max-width:\s*100%/);
  assert.match(buttonRule, /min-width:\s*44px/);
  assert.match(buttonRule, /min-height:\s*44px/);
  assert.match(buttonRule, /display:\s*inline-flex/);
  assert.match(buttonRule, /white-space:\s*nowrap/);
  assert.match(controlsRule, /min-width:\s*0/);
  assert.match(controlsRule, /max-width:\s*100%/);
  assert.match(controlsRule, /flex-wrap:\s*nowrap/);
  assert.match(styles, /\.project-share-button\[aria-busy="true"\]\s*\{/);
  assert.match(styles, /\.project-share-button:disabled\s*\{/);
  assert.match(styles, /\.project-share-button:hover\s*\{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.project-share-button\s*\{[^}]*transform:\s*none !important;/
  );
  assert.match(
    modern,
    /\.project-share-button\s*\{[^}]*border-radius:\s*var\(--radius-sm\);[^}]*font-family:\s*var\(--font-body\);/s
  );
  assert.doesNotMatch(`${styles}\n${modern}`, /\.project-share-button[^}]*width:\s*100vw/s);
});
