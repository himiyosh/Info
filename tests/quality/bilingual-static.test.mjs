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
  renderProjectFeaturedCards,
  renderProjectPanelRows,
  validateProjects
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

function featuredCards(source) {
  return [...source.matchAll(
    /(<article\b[^>]*\bclass="card[^"]*"[^>]*>)([\s\S]*?)<\/article>/gi
  )].map(([, openingTag, body]) => {
    const links = [...body.matchAll(
      /<a class="link" href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<span class="sr-only">/gi
    )].map(([, href, label]) => ({
      label: normalizeText(decodeHtml(label)),
      link: decodeHtml(href)
    }));
    const tagsBlock = body.match(/<div class="tags">([\s\S]*?)<\/div>/i)?.[1] ?? "";
    return {
      badge: normalizeText(decodeHtml(body.match(/<span class="badge">([\s\S]*?)<\/span>/i)?.[1] ?? "")),
      description: normalizeText(decodeHtml(body.match(/<h3>[\s\S]*?<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? "")),
      imageAlt: decodeHtml(attributeValue(body.match(/<img\b[^>]*>/i)?.[0] ?? "", "alt") ?? ""),
      primary: links[0] ?? null,
      source: links[1] ?? null,
      tags: [...tagsBlock.matchAll(/<span>([\s\S]*?)<\/span>/gi)].map(([, tag]) => decodeHtml(tag)),
      targetId: attributeValue(openingTag, "id"),
      title: normalizeText(decodeHtml(body.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] ?? "")),
      wide: /\bcard wide\b/.test(openingTag)
    };
  });
}

function panelRows(source) {
  return [...source.matchAll(
    /(<div class="row"[^>]*>)([\s\S]*?)<\/div>/gi
  )].map(([, openingTag, body]) => {
    const statusTag = body.match(/<span class="status( src)?" aria-hidden="true">([\s\S]*?)<\/span>/i);
    return {
      go: normalizeText(decodeHtml(body.match(/<span class="go" aria-hidden="true">([\s\S]*?)<\/span>/i)?.[1] ?? "")),
      link: decodeHtml(attributeValue(body.match(/<a class="row-link"[^>]*>/i)?.[0] ?? "", "href") ?? ""),
      name: normalizeText(decodeHtml(body.match(/<span class="name">([\s\S]*?)<\/span>/i)?.[1] ?? "")),
      sourceHosted: Boolean(statusTag?.[1]),
      stack: normalizeText(decodeHtml(body.match(/<span class="stack">([\s\S]*?)<\/span>/i)?.[1] ?? "")).split(" · "),
      status: normalizeText(decodeHtml(statusTag?.[2] ?? "")),
      targetId: attributeValue(openingTag, "id"),
      type: normalizeText(decodeHtml(body.match(/<span class="type">([\s\S]*?)<\/span>/i)?.[1] ?? ""))
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
  assert.match(template, /^\s*\{\{projectFeaturedCards\}\}\s*$/m);
  assert.match(template, /^\s*\{\{projectPanelRows\}\}\s*$/m);
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

test("baked project markup escapes every inserted value and rejects bad slugs", () => {
  const hostile = (slug) => ({
    slug,
    link: `https://example.test/?query="<tag>"&mode='safe'`,
    title: { ja: `題名 <t>`, en: `A <title> & "label"` },
    kind: { ja: `種別`, en: "Tool 'type' & <kind>" },
    description: { ja: `説明`, en: `A <description> & "detail"` },
    imageAlt: { ja: `代替`, en: `Alt <text> & "quote"` },
    action: { ja: `開く`, en: `Open <primary> & "inspect"` },
    stack: [`Stack <one>`, `Stack & "two"`],
    sourceAction: { ja: `ソース`, en: `View <source> & "code"` },
    sourceLink: `https://example.test/source?query="<source>"&mode='safe'`,
    image: "assets/example-preview.jpg",
    desktopImageAvif: "assets/example-preview-960w.avif",
    mobileImageAvif: "assets/example-preview-720w.avif"
  });
  const page = { language: "en", siteRoot: "" };

  const card = renderProjectFeaturedCards([hostile("unsafe-card")], page);
  assert.match(
    card,
    /href="https:\/\/example\.test\/\?query=&quot;&lt;tag&gt;&quot;&amp;mode=&#39;safe&#39;"/
  );
  assert.match(card, />A &lt;title&gt; &amp; &quot;label&quot;<\/h3>/);
  assert.match(card, />Tool &#39;type&#39; &amp; &lt;kind&gt;<\/span>/);
  assert.match(card, />A &lt;description&gt; &amp; &quot;detail&quot;<\/p>/);
  assert.match(card, /alt="Alt &lt;text&gt; &amp; &quot;quote&quot;"/);
  assert.match(card, /<span>Stack &lt;one&gt;<\/span><span>Stack &amp; &quot;two&quot;<\/span>/);
  assert.doesNotMatch(card, /<tag>|<title>|<kind>|<description>|<primary>|<source>|<one>/);

  const rows = renderProjectPanelRows(
    [hostile("card-a"), hostile("card-b"), hostile("card-c"), hostile("unsafe-row")],
    page
  );
  assert.match(rows, /<span class="name">A &lt;title&gt; &amp; &quot;label&quot;<\/span>/);
  assert.match(rows, /<span class="stack">Stack &lt;one&gt; · Stack &amp; &quot;two&quot;<\/span>/);
  assert.doesNotMatch(rows, /<tag>|<title>|<one>/);

  assert.throws(
    () => validateProjects([
      {
        ...hostile(`"bad"><slug`),
        proof: undefined,
        proofLink: undefined
      }
    ]),
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

    const cards = featuredCards(source);
    assert.equal(cards.length, 3, `${page.outputPath} must render three featured cards`);
    assert.ok(cards[0].wide, "The first featured card must span the grid");
    const featured = projects.slice(0, 3);
    assert.deepEqual(
      cards.map(({ targetId }) => targetId),
      featured.map((project) => `project-${project.slug}`)
    );
    assert.deepEqual(
      cards.map(({ title }) => title),
      featured.map((project) => project.title[language])
    );
    assert.deepEqual(
      cards.map(({ badge }) => badge),
      featured.map((project) => project.kind[language])
    );
    assert.deepEqual(
      cards.map(({ description }) => description),
      featured.map((project) => project.description[language])
    );
    assert.deepEqual(
      cards.map(({ imageAlt }) => imageAlt),
      featured.map((project) => project.imageAlt[language])
    );
    assert.deepEqual(
      cards.map(({ tags }) => tags),
      featured.map((project) => project.stack)
    );
    assert.deepEqual(
      cards.map(({ primary }) => primary),
      featured.map((project) => ({
        label: project.action[language],
        link: project.link
      }))
    );
    assert.deepEqual(
      cards.map(({ source: sourceEntry }) => sourceEntry),
      featured.map((project) =>
        project.sourceAction
          ? { label: project.sourceAction[language], link: project.sourceLink }
          : null
      )
    );

    const rows = panelRows(source);
    assert.equal(rows.length, 6, `${page.outputPath} must render six panel rows`);
    const listed = projects.slice(3);
    assert.deepEqual(
      rows.map(({ targetId }) => targetId),
      listed.map((project) => `project-${project.slug}`)
    );
    assert.deepEqual(
      rows.map(({ name }) => name),
      listed.map((project) => project.title[language])
    );
    assert.deepEqual(
      rows.map(({ type }) => type),
      listed.map((project) => project.kind[language])
    );
    assert.deepEqual(
      rows.map(({ link }) => link),
      listed.map((project) => project.link)
    );
    assert.deepEqual(
      rows.map(({ stack }) => stack),
      listed.map((project) => project.stack)
    );
    for (const row of rows) {
      const expectedSource = new URL(row.link).hostname === "github.com";
      assert.equal(row.sourceHosted, expectedSource, `${row.targetId} status variant`);
      assert.equal(
        row.status,
        translations[language].projects[expectedSource ? "statusSource" : "statusLive"]
      );
      assert.equal(
        row.go,
        translations[language].projects[expectedSource ? "goCode" : "goOpen"]
      );
    }
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
  // Projects are baked into both routes at build time, so the runtime
  // performs no fetches at all: the catalogue cannot fail to load and the
  // page is complete with JavaScript disabled.
  assert.equal([...scriptSource.matchAll(/\bfetch\s*\(/g)].length, 0);
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
