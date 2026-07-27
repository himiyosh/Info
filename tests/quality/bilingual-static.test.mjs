import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { pages, renderPage } from "../../scripts/generate-static-pages.mjs";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");
const canonicalUrls = {
  ja: "https://himiyosh.github.io/Info/",
  en: "https://himiyosh.github.io/Info/en/"
};
const expectedAlternates = new Map([
  ["ja", canonicalUrls.ja],
  ["en", canonicalUrls.en],
  ["x-default", canonicalUrls.ja]
]);
const htmlEntities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", "\""],
  ["#39", "'"]
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] : undefined;
}

function decodeHtml(value) {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, key) => {
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#") && key !== "#39") {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }
    return htmlEntities.get(key.toLowerCase()) ?? entity;
  });
}

function normalizeText(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function translationAt(language, key) {
  return key.split(".").reduce((value, part) => value?.[part], translations[language]);
}

function alternateMap(source) {
  return new Map(
    [...source.matchAll(
      /<link[^>]*rel="alternate"[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi
    )].map(([, language, href]) => [language, href])
  );
}

function metaContent(source, selectorName, selectorValue) {
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    if (attributeValue(match[0], selectorName) === selectorValue) {
      return attributeValue(match[0], "content");
    }
  }
  return undefined;
}

async function assertLocalReference(reference, baseUrl) {
  if (
    !reference ||
    reference.startsWith("#") ||
    /^(?:mailto|tel|data|javascript):/i.test(reference)
  ) {
    return;
  }

  const url = new URL(reference, baseUrl);
  if (url.origin !== baseUrl.origin) {
    return;
  }

  const relativePath = decodeURIComponent(url.pathname).replace(/^\//, "");
  const targetPath = relativePath === "" || relativePath.endsWith("/")
    ? path.join(repoRoot, relativePath, "index.html")
    : path.join(repoRoot, relativePath);
  assert.ok((await stat(targetPath)).isFile(), `Missing route-local reference: ${reference}`);
}

test("checked-in language pages are deterministic outputs of one template and locale catalogue", async () => {
  const template = await readUtf8("templates/index.html");
  assert.equal(
    [...template.matchAll(/<!DOCTYPE html>/gi)].length,
    1,
    "The canonical template must contain one complete document"
  );
  assert.match(template, /\{\{language\}\}/);
  assert.match(template, /\{\{t:hero\.titleLine1\}\}/);

  for (const page of pages) {
    const generated = await readUtf8(page.outputPath);
    assert.equal(generated, renderPage(template, page), `${page.outputPath} must not drift`);
    assert.match(
      generated,
      /<!-- Generated from templates\/index\.html and i18n\.js\. Run npm run generate:pages\. -->/
    );
    assert.doesNotMatch(generated, /\{\{[^}]+\}\}/);
  }

  const { stderr } = await execFileAsync(
    process.execPath,
    ["scripts/generate-static-pages.mjs", "--check"],
    { cwd: repoRoot }
  );
  assert.equal(stderr, "");

  const packageJson = JSON.parse(await readUtf8("package.json"));
  assert.equal(packageJson.scripts["check:generated"], "node scripts/generate-static-pages.mjs --check");
  assert.match(packageJson.scripts["check:quality"], /npm run check:generated/);
});

test("both routes provide complete localized initial HTML and no-JavaScript project context", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));

  for (const page of pages) {
    const source = await readUtf8(page.outputPath);
    const language = page.language;
    assert.match(source, new RegExp(`<html lang="${language}"(?:\\s|>)`));
    assert.equal(
      normalizeText(source.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
      translations[language].meta.title
    );
    assert.equal(metaContent(source, "name", "description"), translations[language].meta.description);
    assert.equal(metaContent(source, "property", "og:title"), translations[language].meta.title);
    assert.equal(
      metaContent(source, "property", "og:description"),
      translations[language].meta.description
    );
    assert.equal(
      metaContent(source, "property", "og:image:alt"),
      translations[language].meta.shareImageAlt
    );
    assert.equal(metaContent(source, "name", "twitter:title"), translations[language].meta.title);
    assert.equal(
      metaContent(source, "name", "twitter:description"),
      translations[language].meta.description
    );
    assert.equal(
      metaContent(source, "name", "twitter:image:alt"),
      translations[language].meta.shareImageAlt
    );
    const languageLink = source.match(/<a\b[^>]*id="lang-toggle"[\s\S]*?<\/a>/i)?.[0];
    assert.ok(languageLink, `${page.outputPath} must include the language link`);
    assert.equal(
      attributeValue(languageLink.match(/^<a\b[^>]*>/i)?.[0] ?? "", "lang"),
      undefined,
      "The current-language aria-label must not inherit the destination language"
    );
    assert.match(
      languageLink,
      new RegExp(`<span\\s+lang="${page.alternateLanguage}"[^>]*data-language-label`)
    );

    for (const match of source.matchAll(/<([a-z][\w:-]*)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>/gi)) {
      const [openingTag, tagName, key] = match;
      if (attributeValue(openingTag, "data-i18n-dynamic") !== undefined) {
        continue;
      }
      const contentStart = match.index + openingTag.length;
      const closing = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "gi");
      closing.lastIndex = contentStart;
      const closingMatch = closing.exec(source);
      assert.ok(closingMatch, `Missing closing tag for ${page.outputPath}:${key}`);
      assert.equal(
        normalizeText(source.slice(contentStart, closingMatch.index)),
        normalizeText(translationAt(language, key)),
        `${page.outputPath} must statically localize ${key}`
      );
    }

    for (const [marker, target] of [
      ["data-i18n-content", "content"],
      ["data-i18n-alt", "alt"],
      ["data-i18n-aria-label", "aria-label"]
    ]) {
      for (const match of source.matchAll(new RegExp(`<[^>]*\\b${marker}="([^"]+)"[^>]*>`, "gi"))) {
        const key = match[1];
        assert.equal(
          normalizeText(attributeValue(match[0], target) ?? ""),
          normalizeText(translationAt(language, key)),
          `${page.outputPath} must statically localize ${target} for ${key}`
        );
      }
    }

    const fallback = source.match(
      /<div\b[^>]*id="projects-fallback"[^>]*>([\s\S]*?)<\/div>/i
    )?.[1];
    assert.ok(fallback, `${page.outputPath} must retain the no-JavaScript fallback`);
    assert.ok(
      normalizeText(fallback).startsWith(translations[language].projects.fallback),
      `${page.outputPath} must localize fallback context`
    );
    assert.deepEqual(
      [...fallback.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]),
      projects.map((project) => project.link)
    );
  }
});

test("route metadata and sitemap publish one reciprocal canonical language cluster", async () => {
  for (const page of pages) {
    const source = await readUtf8(page.outputPath);
    const canonical = source.match(
      /<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i
    )?.[1];
    assert.equal(canonical, canonicalUrls[page.language]);
    assert.equal(metaContent(source, "property", "og:url"), canonical);
    assert.deepEqual([...alternateMap(source)], [...expectedAlternates]);
  }

  const sitemap = await readUtf8("sitemap.xml");
  assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.match(sitemap, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  assert.equal(urlBlocks.length, 2);
  assert.deepEqual(
    urlBlocks.map((block) => block.match(/<loc>([^<]+)<\/loc>/)?.[1]),
    [canonicalUrls.ja, canonicalUrls.en]
  );
  for (const block of urlBlocks) {
    const alternates = new Map(
      [...block.matchAll(
        /<xhtml:link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"\s*\/>/g
      )].map(([, language, href]) => [language, href])
    );
    assert.deepEqual([...alternates], [...expectedAlternates]);
  }

  const robots = await readUtf8("robots.txt");
  assert.match(robots, /^Sitemap: https:\/\/himiyosh\.github\.io\/Info\/sitemap\.xml$/m);
});

test("both routes resolve shared assets locally and load one shared project catalogue", async () => {
  for (const page of pages) {
    const source = await readUtf8(page.outputPath);
    const baseUrl = new URL(
      page.language === "ja" ? "https://local.test/" : "https://local.test/en/"
    );
    const references = [
      ...source.matchAll(/\b(?:src|href)="([^"]+)"/g)
    ].map((match) => match[1]);
    for (const match of source.matchAll(/\b(?:srcset|imagesrcset)="([^"]+)"/g)) {
      references.push(
        ...match[1].split(",").map((candidate) => candidate.trim().split(/\s+/)[0])
      );
    }
    for (const reference of references) {
      await assertLocalReference(reference, baseUrl);
    }
  }

  const [scriptSource, i18nSource] = await Promise.all([
    readUtf8("script.js"),
    readUtf8("i18n.js")
  ]);
  assert.equal([...scriptSource.matchAll(/\bfetch\s*\(/g)].length, 1);
  assert.match(
    scriptSource,
    /fetch\(window\.siteI18n\.resolveSitePath\("projects\.json"\)/
  );
  assert.match(
    scriptSource,
    /window\.siteI18n\.resolveSitePath\(project\.(?:image|desktopImageAvif|mobileImageAvif)\)/
  );
  assert.doesNotMatch(i18nSource, /\bfetch\s*\(/);
});

test("Pages publishes the English route but excludes canonical generation internals", async () => {
  const whitelist = (await readUtf8(".github/pages-artifact-whitelist.txt"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.ok(whitelist.includes("en"));
  for (const internalPath of ["templates", "scripts", "tests", ".github", "package.json"]) {
    assert.ok(!whitelist.includes(internalPath), `${internalPath} must not be published`);
  }

  const workflow = await readUtf8(".github/workflows/pages.yml");
  assert.ok(
    workflow.indexOf("npm run check:generated") <
      workflow.indexOf("done < .github/pages-artifact-whitelist.txt"),
    "Generated drift must fail before the artifact is assembled"
  );
  assert.match(workflow, /permissions:\n\s+contents:\s+read/);
  assert.match(workflow, /uses:\s*actions\/setup-node@[a-f0-9]{40}/);
});
