import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { pages, renderPage } from "../../scripts/generate-static-pages.mjs";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const canonicalEmail = "himiyosh@gmail.com";

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] : undefined;
}

function helperApi(source, windowOverrides = {}, documentOverrides = {}) {
  const helperEnd = source.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.notEqual(helperEnd, -1, "Contact copy helpers must precede DOM initialization");
  const helperSource = source.slice(0, helperEnd);
  return vm.runInNewContext(
    `(() => {
      ${helperSource}
      return {
        CONTACT_EMAIL_ADDRESS,
        CONTACT_COPY_STATUS_KEYS,
        createContactEmailCopyController,
        selectContactEmailForManualCopy,
        writeContactEmailToClipboard
      };
    })()`,
    {
      window: windowOverrides,
      document: documentOverrides
    },
    { timeout: 1000 }
  );
}

class FakeElement {
  constructor({ hidden = true, ownerDocument = null } = {}) {
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = hidden;
    this.listeners = new Map();
    this.ownerDocument = ownerDocument;
    this.textHistory = [];
    this._textContent = "";
    this.focusCalls = 0;
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

  focus() {
    this.focusCalls += 1;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
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
  document = { activeElement: null },
  language = "ja",
  copyText = async () => true,
  selectAddress = () => false
} = {}) {
  const button = new FakeElement({ ownerDocument: document });
  const status = new FakeElement({ ownerDocument: document });
  const scheduled = [];
  let currentLanguage = language;
  const translate = (key) =>
    key.split(".").reduce((value, part) => value?.[part], translations[currentLanguage]);
  const controller = api.createContactEmailCopyController({
    address: canonicalEmail,
    button,
    status,
    copyText,
    selectAddress,
    translate,
    schedule: (callback) => scheduled.push(callback)
  });
  return {
    button,
    controller,
    document,
    flush() {
      scheduled.splice(0).forEach((callback) => callback());
    },
    setLanguage(nextLanguage) {
      currentLanguage = nextLanguage;
      controller.reset();
    },
    status
  };
}

test("canonical and generated Contact markup keeps mailto primary with localized progressive copy UI", async () => {
  const template = await readUtf8("templates/index.html");

  for (const page of pages) {
    const source = await readUtf8(page.outputPath);
    assert.equal(source, renderPage(template, page), `${page.outputPath} must not drift`);

    const contactStart = source.indexOf('<section class="contact section-shell"');
    const contactEnd = source.indexOf("</section>", contactStart);
    const contact = source.slice(contactStart, contactEnd);
    const mailtoIndex = contact.indexOf(`href="mailto:${canonicalEmail}"`);
    const copyIndex = contact.indexOf('id="copy-email-address"');
    const githubIndex = contact.indexOf('href="https://github.com/himiyosh"');
    assert.ok(contactStart >= 0 && contactEnd > contactStart);
    assert.ok(mailtoIndex >= 0, `${page.outputPath} must keep the canonical mailto link`);
    assert.ok(
      mailtoIndex < copyIndex && copyIndex < githubIndex,
      `${page.outputPath} must keep mailto first, then copy, then GitHub`
    );
    assert.ok(
      contact.includes(`<strong id="contact-email-address">${canonicalEmail}</strong>`)
    );

    const copyTag = contact.match(/<button\b[^>]*id="copy-email-address"[^>]*>/i)?.[0];
    const statusTag = contact.match(/<p\b[^>]*id="copy-email-status"[^>]*>/i)?.[0];
    assert.ok(copyTag);
    assert.ok(statusTag);
    assert.match(copyTag, /\shidden(?:\s|>)/);
    assert.equal(attributeValue(copyTag, "aria-describedby"), "copy-email-status");
    assert.equal(attributeValue(statusTag, "role"), "status");
    assert.equal(attributeValue(statusTag, "aria-live"), "polite");
    assert.equal(attributeValue(statusTag, "aria-atomic"), "true");
    assert.match(statusTag, /\shidden(?:\s|>)/);
    assert.match(
      contact,
      new RegExp(
        `<span data-i18n="contact\\.copyEmail">${translations[page.language].contact.copyEmail}</span>`
      )
    );
  }
});

test("copy activation writes only the canonical address, keeps focus, and re-announces repeats", async () => {
  const script = await readUtf8("script.js");
  const api = helperApi(script);
  const copiedValues = [];
  const harness = createControllerHarness(api, {
    copyText: async (value) => {
      copiedValues.push(value);
      return true;
    }
  });

  assert.equal(api.CONTACT_EMAIL_ADDRESS, canonicalEmail);
  assert.equal(harness.button.hidden, false);
  assert.equal(harness.status.hidden, false);

  harness.button.focus();
  await harness.button.click();
  harness.flush();
  await harness.button.click();
  harness.flush();

  assert.deepEqual(copiedValues, [canonicalEmail, canonicalEmail]);
  assert.equal(harness.status.textContent, translations.ja.contact.copySuccess);
  assert.equal(
    harness.status.textHistory.filter((value) => value === translations.ja.contact.copySuccess)
      .length,
    2
  );
  assert.equal(harness.button.dataset.copyState, "success");
  assert.equal(harness.button.getAttribute("aria-busy"), undefined);
  assert.equal(harness.button.focusCalls, 1);
  assert.equal(harness.document.activeElement, harness.button);
});

test("unavailable clipboard selects only the visible address and gives localized manual feedback", async () => {
  let clipboardCalls = 0;
  let selectedNode = null;
  const browserDocument = {
    activeElement: null,
    createRange: () => ({
      selectNodeContents(node) {
        selectedNode = node;
      }
    })
  };
  const selection = {
    addRange() {},
    removeAllRanges() {},
    toString: () => selectedNode?.textContent ?? ""
  };
  const script = await readUtf8("script.js");
  const api = helperApi(
    script,
    {
      isSecureContext: false,
      navigator: {
        clipboard: {
          writeText() {
            clipboardCalls += 1;
          }
        }
      },
      getSelection: () => selection
    },
    browserDocument
  );
  const addressElement = { textContent: canonicalEmail };
  const harness = createControllerHarness(api, {
    document: browserDocument,
    copyText: api.writeContactEmailToClipboard,
    selectAddress: () =>
      api.selectContactEmailForManualCopy(addressElement, canonicalEmail)
  });

  harness.button.focus();
  await harness.button.click();
  harness.flush();

  assert.equal(clipboardCalls, 0);
  assert.equal(selectedNode, addressElement);
  assert.equal(harness.status.textContent, translations.ja.contact.copyManualSelected);
  assert.equal(harness.button.dataset.copyState, "error");
  assert.equal(harness.document.activeElement, harness.button);
});

test("overlapping copy activations ignore an older rejection after the latest success", async () => {
  const script = await readUtf8("script.js");
  const api = helperApi(script);
  const firstClipboardWrite = deferred();
  const secondClipboardWrite = deferred();
  const clipboardWrites = [firstClipboardWrite, secondClipboardWrite];
  let manualSelectionCalls = 0;
  const harness = createControllerHarness(api, {
    copyText: () => clipboardWrites.shift().promise,
    selectAddress: () => {
      manualSelectionCalls += 1;
      return true;
    }
  });

  harness.button.focus();
  const firstActivation = harness.button.click();
  const secondActivation = harness.button.click();
  assert.equal(clipboardWrites.length, 0);
  assert.equal(harness.button.dataset.copyState, "loading");
  assert.equal(harness.button.getAttribute("aria-busy"), "true");

  secondClipboardWrite.resolve(true);
  await secondActivation;
  harness.flush();
  assert.equal(harness.status.textContent, translations.ja.contact.copySuccess);
  assert.equal(harness.button.dataset.copyState, "success");

  firstClipboardWrite.reject(new Error("stale clipboard rejection"));
  await firstActivation;
  harness.flush();

  assert.equal(harness.status.textContent, translations.ja.contact.copySuccess);
  assert.equal(harness.button.dataset.copyState, "success");
  assert.equal(harness.button.getAttribute("aria-busy"), undefined);
  assert.equal(manualSelectionCalls, 0);
  assert.equal(
    harness.status.textHistory.filter((value) => value === translations.ja.contact.copySuccess)
      .length,
    1
  );
  assert.equal(harness.document.activeElement, harness.button);
});

test("clipboard rejection surfaces failure without exception text and keeps the manual mailto path", async () => {
  const script = await readUtf8("script.js");
  const api = helperApi(script);
  const technicalMessage = "NotAllowedError: user denied clipboard";
  const harness = createControllerHarness(api, {
    copyText: async () => {
      throw new Error(technicalMessage);
    },
    selectAddress: () => false
  });

  await assert.doesNotReject(() => harness.button.click());
  harness.flush();

  assert.equal(harness.status.textContent, translations.ja.contact.copyFailure);
  assert.ok(!harness.status.textContent.includes(technicalMessage));
  assert.equal(harness.button.dataset.copyState, "error");
  const template = await readUtf8("templates/index.html");
  assert.ok(template.includes(`href="mailto:${canonicalEmail}"`));
  assert.ok(template.includes(`<strong id="contact-email-address">${canonicalEmail}</strong>`));
});

test("language reset clears stale feedback and the next activation uses the current locale", async () => {
  const script = await readUtf8("script.js");
  const api = helperApi(script);
  const harness = createControllerHarness(api);

  await harness.button.click();
  harness.flush();
  assert.equal(harness.status.textContent, translations.ja.contact.copySuccess);

  harness.setLanguage("en");
  assert.equal(harness.status.textContent, "");
  assert.equal(harness.button.dataset.copyState, "idle");

  await harness.button.click();
  harness.flush();
  assert.equal(harness.status.textContent, translations.en.contact.copySuccess);
  assert.match(
    script,
    /document\.addEventListener\("site-languagechange", \(\) => \{\s*contactEmailCopyController\.reset\(\);/
  );
  assert.match(script, /window\.addEventListener\("pageshow", contactEmailCopyController\.reset\)/);
});

test("copy control styling preserves a 44px target, one-line labels, and narrow-layout containment", async () => {
  const [styles, modern] = await Promise.all([
    readUtf8("styles.css"),
    readUtf8("modern.css")
  ]);
  const baseButton = styles.match(/\.contact-copy-button\s*\{([^}]*)\}/s)?.[1] ?? "";
  const method = styles.match(/\.contact-email-method\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(baseButton, /min-height:\s*44px/);
  assert.match(baseButton, /max-width:\s*100%/);
  assert.match(baseButton, /white-space:\s*nowrap/);
  assert.match(method, /min-width:\s*0/);
  assert.match(method, /display:\s*grid/);
  assert.match(styles, /\.contact-copy-button\[hidden\],[\s\S]*\.contact-copy-status\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /\.contact-copy-button:hover\s*\{/);
  assert.match(modern, /\.contact-copy-button:hover\s*\{/);
  assert.match(modern, /\.contact-copy-button\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s);
  assert.doesNotMatch(`${styles}\n${modern}`, /\.contact-copy-button[^}]*width:\s*100vw/s);
});
