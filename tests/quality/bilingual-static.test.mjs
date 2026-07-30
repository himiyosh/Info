import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  pages,
  renderPage,
  renderProjectFallbackSummaries
} from "../../scripts/generate-static-pages.mjs";

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
  if (!anchor) {
    return null;
  }
  return {
    label: normalizeText(anchor[2].match(/<span>([\s\S]*?)<\/span>/i)?.[1] ?? ""),
    link: decodeHtml(attributeValue(anchor[1], "href") ?? "")
  };
}

function fallbackSummaries(source) {
  return [...source.matchAll(
    /(<article\b[^>]*\bclass="[^"]*\bprojects-fallback-card\b[^"]*"[^>]*>)([\s\S]*?)<\/article>/gi
  )].map(([, openingTag, body]) => {
    const permalink = body.match(
      /<a\b[^>]*\bclass="[^"]*\bprojects-fallback-permalink\b[^"]*"[^>]*>/i
    )?.[0];
    const proofText = elementContent(body, "p", "project-proof-text") ?? "";
    return {
      description: normalizeText(
        elementContent(body, "p", "projects-fallback-description") ?? ""
      ),
      kind: normalizeText(elementContent(body, "p", "projects-fallback-kind") ?? ""),
      permalink: decodeHtml(attributeValue(permalink ?? "", "href") ?? ""),
      primary: actionEntry(body, "primary"),
      proof: actionEntry(body, "evidence")
        ? {
            link: actionEntry(body, "evidence").link,
            statement: normalizeText(
              proofText.match(
                /<span\b[^>]*\bclass="project-proof-label"[^>]*>[\s\S]*?<\/span>\s*<span>([\s\S]*?)<\/span>/i
              )?.[1] ?? ""
            )
          }
        : null,
      source: actionEntry(body, "secondary"),
      stack: elementContent(body, "p", "projects-fallback-stack")
        ? normalizeText(elementContent(body, "p", "projects-fallback-stack")).split(" · ")
        : null,
      targetId: attributeValue(openingTag, "id"),
      title: normalizeText(elementContent(body, "h3", "projects-fallback-title") ?? "")
    };
  });
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
  const [template, generatorSource, projects] = await Promise.all([
    readUtf8("templates/index.html"),
    readUtf8("scripts/generate-static-pages.mjs"),
    readUtf8("projects.json").then(JSON.parse)
  ]);
  assert.equal(
    [...template.matchAll(/<!DOCTYPE html>/gi)].length,
    1,
    "The canonical template must contain one complete document"
  );
  assert.match(template, /\{\{language\}\}/);
  assert.match(template, /\{\{t:hero\.titleLine1\}\}/);
  assert.match(template, /^\s*\{\{projectFallbackSummaries\}\}\s*$/m);
  assert.equal(
    [...generatorSource.matchAll(/readFile\(projectsPath,\s*"utf8"\)/g)].length,
    1,
    "The generator must read the canonical project catalogue once"
  );
  for (const project of projects) {
    assert.doesNotMatch(
      template,
      new RegExp(escapeRegExp(`href="${project.link}"`)),
      "Project destinations must come from projects.json rather than template literals"
    );
  }

  for (const page of pages) {
    const generated = await readUtf8(page.outputPath);
    assert.equal(generated, renderPage(template, page, projects), `${page.outputPath} must not drift`);
    assert.match(
      generated,
      /<!-- Generated from templates\/index\.html, i18n\.js, and projects\.json\. Run npm run generate:pages\. -->/
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

test("fallback generation validates fragments and escapes every inserted project value", () => {
  const rendered = renderProjectFallbackSummaries([
    {
      slug: "unsafe-looking-project",
      link: `https://example.test/?query="<tag>"&mode='safe'`,
      title: { en: `A <title> & "label"` },
      kind: { en: "Tool 'type' & <kind>" },
      description: { en: `A <description> & "detail"` },
      action: { en: `Open <primary> & "inspect"` },
      stack: [`Stack <one>`, `Stack & "two"`],
      sourceAction: { en: `View <source> & "code"` },
      sourceLink: `https://example.test/source?query="<source>"&mode='safe'`,
      proof: { en: `Proof <statement> & "detail"` },
      proofLink: `https://example.test/proof?query="<proof>"&mode='safe'`
    }
  ], "en");

  assert.match(
    rendered,
    /href="https:\/\/example\.test\/\?query=&quot;&lt;tag&gt;&quot;&amp;mode=&#39;safe&#39;"/
  );
  assert.match(rendered, />A &lt;title&gt; &amp; &quot;label&quot;<\/h3>/);
  assert.match(rendered, />Tool &#39;type&#39; &amp; &lt;kind&gt;<\/p>/);
  assert.match(rendered, />A &lt;description&gt; &amp; &quot;detail&quot;<\/p>/);
  assert.match(rendered, />Stack &lt;one&gt; · Stack &amp; &quot;two&quot;<\/p>/);
  assert.match(rendered, />Open &lt;primary&gt; &amp; &quot;inspect&quot;<\/span>/);
  assert.match(rendered, />View &lt;source&gt; &amp; &quot;code&quot;<\/span>/);
  assert.match(rendered, />Proof &lt;statement&gt; &amp; &quot;detail&quot;<\/span>/);
  assert.doesNotMatch(
    rendered,
    /<tag>|<title>|<kind>|<description>|<primary>|<source>|<proof>|<one>/
  );
  assert.throws(
    () => renderProjectFallbackSummaries([
      {
        slug: `"bad"><slug`,
        link: "https://example.test/",
        title: { en: "Title" },
        kind: { en: "Kind" },
        description: { en: "Description" },
        action: { en: "Open" }
      }
    ], "en"),
    /lowercase kebab-case/
  );
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
    const entries = fallbackSummaries(fallback);
    assert.equal(entries.length, 9, `${page.outputPath} must render all nine fallback summaries`);
    assert.deepEqual(
      entries.map(({ targetId }) => targetId),
      projects.map((project) => `project-${project.slug}`)
    );
    assert.deepEqual(
      entries.map(({ permalink }) => permalink),
      projects.map((project) => `#project-${project.slug}`)
    );
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
      projects.map((project) => project.stack ?? null)
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
      entries.map(({ proof }) => proof),
      projects.map((project) =>
        project.proof
          ? { link: project.proofLink, statement: project.proof[language] }
          : null
      )
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
  assert.ok(whitelist.includes("en/index.html"));
  assert.ok(!whitelist.includes("en"), "English publication must use exact owned paths");
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
