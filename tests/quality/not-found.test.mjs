import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  notFoundPage,
  renderNotFoundPage
} from "../../scripts/generate-static-pages.mjs";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] : undefined;
}

function stylesheet(source) {
  return source.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? "";
}

test("root 404 is a deterministic bilingual output of one template and locale catalogue", async () => {
  const [template, generated] = await Promise.all([
    readUtf8("templates/404.html"),
    readUtf8(notFoundPage.outputPath)
  ]);

  assert.equal(generated, renderNotFoundPage(template));
  assert.match(
    generated,
    /<!-- Generated from templates\/404\.html and i18n\.js\. Run npm run generate:pages\. -->/
  );
  assert.doesNotMatch(generated, /\{\{[^}]+\}\}/);
  for (const language of ["ja", "en"]) {
    assert.ok(generated.includes(translations[language].notFound.title));
    assert.ok(generated.includes(translations[language].notFound.guidance));
    assert.ok(generated.includes(translations[language].notFound.homeAction));
    assert.ok(generated.includes(translations[language].notFound.projectsAction));
    assert.ok(generated.includes(translations[language].notFound.contactAction));
  }
});

test("404 metadata preserves a real error response contract without redirect or indexing signals", async () => {
  const [source, sitemap] = await Promise.all([
    readUtf8("404.html"),
    readUtf8("sitemap.xml")
  ]);
  const robotsTag = [...source.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => attributeValue(tag, "name") === "robots");

  assert.ok(robotsTag, "404.html must include robots metadata");
  assert.equal(attributeValue(robotsTag, "content"), "noindex");
  assert.doesNotMatch(source, /<link\b[^>]*rel="canonical"/i);
  assert.doesNotMatch(source, /<meta\b[^>]*http-equiv="refresh"/i);
  assert.doesNotMatch(source, /<script\b/i);
  assert.doesNotMatch(source, /\blocation\.(?:assign|replace|href)\b/);
  assert.doesNotMatch(sitemap, /(?:<loc>|href=")[^"<]*404\.html/i);
});

test("404 recovery remains semantic, bilingual, and complete without JavaScript", async () => {
  const source = await readUtf8("404.html");

  assert.equal([...source.matchAll(/<main\b/gi)].length, 1);
  assert.equal([...source.matchAll(/<h1\b/gi)].length, 1);
  assert.match(source, /<section\b[^>]*lang="ja"[^>]*aria-labelledby="japanese-heading"/i);
  assert.match(
    source,
    /<section\b[^>]*id="english"[^>]*lang="en"[^>]*aria-labelledby="english-heading"/i
  );
  assert.match(source, /<nav\b[^>]*aria-label="日本語の復帰先"/);
  assert.match(source, /<nav\b[^>]*aria-label="Recovery links in English"/);

  for (const href of [
    "/Info/",
    "/Info/#projects",
    "/Info/#contact",
    "/Info/en/",
    "/Info/en/#projects",
    "/Info/en/#contact",
    "https://github.com/himiyosh",
    "mailto:himiyosh@gmail.com"
  ]) {
    assert.match(source, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
});

test("404 links and assets resolve from arbitrarily deep missing project paths", async () => {
  const source = await readUtf8("404.html");
  const baseUrl = new URL("https://himiyosh.github.io/Info/missing/deep/route");
  const references = [...source.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("#"));

  for (const reference of references) {
    if (/^(?:https:|mailto:)/i.test(reference)) {
      continue;
    }
    assert.ok(
      reference.startsWith("/Info/"),
      `Project-local 404 reference must be root-safe: ${reference}`
    );
    const resolved = new URL(reference, baseUrl);
    assert.equal(resolved.origin, baseUrl.origin);
    assert.ok(resolved.pathname.startsWith("/Info/"));
  }

  for (const assetPath of ["favicon.svg", "tokens.css"]) {
    const assetStats = await stat(path.join(repoRoot, assetPath));
    assert.ok(assetStats.isFile(), `404 asset must exist: ${assetPath}`);
    assert.match(source, new RegExp(`(?:href|src)="/Info/${assetPath.replace(".", "\\.")}"`));
  }
});

test("404 styling keeps recovery controls and the focused skip link contained at narrow widths", async () => {
  const css = stylesheet(await readUtf8("404.html"));
  const linkRule = css.match(/\.not-found-link\s*\{([^}]*)\}/s)?.[1] ?? "";
  const skipRule = css.match(/\.skip-link\s*\{([^}]*)\}/s)?.[1] ?? "";
  const focusRule = css.match(/\.not-found-link:focus-visible\s*\{([^}]*)\}/s)?.[1] ?? "";
  const activeRule = css.match(/\.not-found-link:active\s*\{([^}]*)\}/s)?.[1] ?? "";
  const disabledRule =
    css.match(/\.not-found-link\[aria-disabled="true"\]\s*\{([^}]*)\}/s)?.[1] ?? "";
  const languageGridRule =
    css.match(/\.not-found-languages\s*\{([^}]*)\}/s)?.[1] ?? "";
  const titleRule = css.match(/\.not-found-title span\s*\{([^}]*)\}/s)?.[1] ?? "";

  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(linkRule, /min-height:\s*44px/);
  assert.match(linkRule, /max-width:\s*100%/);
  assert.match(linkRule, /white-space:\s*nowrap/);
  assert.match(
    skipRule,
    /inset-inline-start:\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-left\)\)/
  );
  assert.match(
    skipRule,
    /inset-inline-end:\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-right\)\)/
  );
  assert.match(
    skipRule,
    /max-width:\s*calc\(\s*100%\s*-\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-left\)\)\s*-\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-right\)\)\s*\)/s
  );
  assert.match(skipRule, /overflow-wrap:\s*anywhere/);
  assert.match(skipRule, /white-space:\s*normal/);
  assert.match(css, /\.skip-link:focus-visible\s*\{\s*transform:\s*none;/);
  assert.match(focusRule, /outline:\s*3px solid var\(--color-focus\)/);
  assert.match(activeRule, /transform:\s*translateY\(1px\)/);
  assert.match(disabledRule, /cursor:\s*not-allowed/);
  assert.match(disabledRule, /opacity:\s*0\.55/);
  assert.match(titleRule, /min-width:\s*0/);
  assert.match(titleRule, /overflow-wrap:\s*anywhere/);
  assert.match(languageGridRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(
    css,
    /@media \(min-width:\s*48rem\)[\s\S]*?\.not-found-languages\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.not-found-link:active\s*\{[^}]*transform:\s*none/s
  );
  assert.doesNotMatch(css, /\bwidth:\s*100vw\b/);
  assert.doesNotMatch(css, /overflow-x:\s*hidden/);
  assert.doesNotMatch(css, /min-height:\s*100vh/);
});

test("strict Pages artifact policy includes the custom 404 and excludes its sources", async () => {
  const whitelist = (await readUtf8(".github/pages-artifact-whitelist.txt"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.ok(whitelist.includes("404.html"));
  assert.ok(!whitelist.includes("templates"));
  assert.ok(!whitelist.includes("tests"));
  assert.ok(!whitelist.includes("scripts"));
});
