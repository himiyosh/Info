import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const canonicalRoot = "https://himiyosh.github.io/Info/";
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function metaContent(html, attribute, value) {
  return html.match(
    new RegExp(`<meta\\b[^>]*${attribute}="${value}"[^>]*content="([^"]*)"[^>]*>`, "i")
  )?.[1];
}

function linkHref(html, rel, hreflang = null) {
  const languageAttribute = hreflang ? `[^>]*hreflang="${hreflang}"` : "";
  return html.match(
    new RegExp(`<link\\b[^>]*rel="${rel}"${languageAttribute}[^>]*href="([^"]+)"[^>]*>`, "i")
  )?.[1];
}

function shareHelperApi(source) {
  const helperEnd = source.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.notEqual(helperEnd, -1, "Project share helpers must precede DOM initialization");
  return vm.runInNewContext(
    `(() => {
      ${source.slice(0, helperEnd)}
      return { createProjectShareUrl };
    })()`,
    { URL, document: {}, window: {} },
    { timeout: 1000 }
  );
}

test("project share controls build localized static routes without changing permalink fragments", async () => {
  const [scriptSource, permalinkTests] = await Promise.all([
    readUtf8("script.js"),
    readUtf8("tests/quality/project-permalinks.test.mjs")
  ]);
  const { createProjectShareUrl } = shareHelperApi(scriptSource);

  assert.equal(
    createProjectShareUrl("techdb", "https://himiyosh.github.io/Info/?utm_source=test"),
    "https://himiyosh.github.io/Info/share/techdb/"
  );
  assert.equal(
    createProjectShareUrl("techdb", "https://himiyosh.github.io/Info/en/#project-portfolio"),
    "https://himiyosh.github.io/Info/en/share/techdb/"
  );
  assert.throws(
    () => createProjectShareUrl("../techdb", "https://himiyosh.github.io/Info/"),
    /project slug/
  );
  assert.match(scriptSource, /permalink\.setAttribute\("href", `#\$\{article\.id\}`\)/);
  assert.match(permalinkTests, /#project-\$\{project\.slug\}/);
});

test("every project has exact Japanese and English share-page metadata and fallback content", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));

  for (const project of projects) {
    for (const language of ["ja", "en"]) {
      const routePrefix = language === "ja" ? "" : "en/";
      const routePath = `${routePrefix}share/${project.slug}/`;
      const page = await readUtf8(`${routePath}index.html`);
      const permanentUrl = `${canonicalRoot}${routePath}`;
      const alternateRoutePath =
        language === "ja" ? `en/share/${project.slug}/` : `share/${project.slug}/`;
      const alternateLanguage = language === "ja" ? "en" : "ja";
      const locale = language === "ja" ? "ja_JP" : "en_US";
      const alternateLocale = language === "ja" ? "en_US" : "ja_JP";
      const portfolioUrl =
        `${canonicalRoot}${language === "en" ? "en/" : ""}#project-${project.slug}`;
      const imageUrl = `${canonicalRoot}${project.image}`;

      assert.match(page, /Generated from templates\/share\.html and projects\.json/);
      assert.match(page, new RegExp(`<html lang="${language}"`));
      assert.match(page, new RegExp(`<title>${escapeHtml(project.title[language])} \\| himiyosh</title>`));
      assert.equal(metaContent(page, "name", "description"), escapeHtml(project.description[language]));
      assert.equal(metaContent(page, "name", "robots"), "noindex,follow");
      assert.equal(metaContent(page, "property", "og:type"), "website");
      assert.equal(metaContent(page, "property", "og:site_name"), "himiyosh");
      assert.equal(metaContent(page, "property", "og:title"), `${escapeHtml(project.title[language])} | himiyosh`);
      assert.equal(metaContent(page, "property", "og:description"), escapeHtml(project.description[language]));
      assert.equal(metaContent(page, "property", "og:url"), permanentUrl);
      assert.equal(metaContent(page, "property", "og:locale"), locale);
      assert.equal(metaContent(page, "property", "og:locale:alternate"), alternateLocale);
      assert.equal(metaContent(page, "property", "og:image"), imageUrl);
      assert.equal(metaContent(page, "property", "og:image:type"), "image/jpeg");
      assert.equal(metaContent(page, "property", "og:image:width"), "960");
      assert.equal(metaContent(page, "property", "og:image:height"), "540");
      assert.equal(metaContent(page, "property", "og:image:alt"), escapeHtml(project.imageAlt[language]));
      assert.equal(metaContent(page, "name", "twitter:card"), "summary_large_image");
      assert.equal(metaContent(page, "name", "twitter:title"), `${escapeHtml(project.title[language])} | himiyosh`);
      assert.equal(metaContent(page, "name", "twitter:description"), escapeHtml(project.description[language]));
      assert.equal(metaContent(page, "name", "twitter:image"), imageUrl);
      assert.equal(metaContent(page, "name", "twitter:image:alt"), escapeHtml(project.imageAlt[language]));
      assert.equal(linkHref(page, "canonical"), permanentUrl);
      assert.equal(linkHref(page, "alternate", language), permanentUrl);
      assert.equal(
        linkHref(page, "alternate", alternateLanguage),
        `${canonicalRoot}${alternateRoutePath}`
      );
      assert.equal(linkHref(page, "alternate", "x-default"), `${canonicalRoot}share/${project.slug}/`);
      assert.match(page, new RegExp(`<h1[^>]*>${escapeHtml(project.title[language])}</h1>`));
      assert.match(page, new RegExp(`<p class="share-project-kind">${escapeHtml(project.kind[language])}</p>`));
      assert.match(page, new RegExp(`<p class="share-project-description">${escapeHtml(project.description[language])}</p>`));
      assert.match(
        page,
        new RegExp(`<img[^>]*src="[^"]*${project.image}"[^>]*alt="${escapeHtml(project.imageAlt[language])}"[^>]*width="960"[^>]*height="540"`)
      );
      assert.match(page, new RegExp(`href="${portfolioUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
      assert.match(page, new RegExp(`href="${project.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    }
  }

  assert.equal(projects.length, 9);
});

test("share-page generator exposes exact inventory and escapes hostile localized metadata", async () => {
  const { renderProjectSharePage, sharePages } = await import(
    `../../scripts/generate-static-pages.mjs?share-pages=${Date.now()}`
  );
  const projects = JSON.parse(await readUtf8("projects.json"));
  const expectedPaths = projects.flatMap(({ slug }) => [
    `share/${slug}/index.html`,
    `en/share/${slug}/index.html`
  ]);

  assert.deepEqual(
    sharePages.map(({ outputPath }) => outputPath).sort(),
    expectedPaths.sort()
  );

  const hostileProject = {
    slug: "safe-slug",
    title: { ja: `A & "B" <C>`, en: "Safe" },
    kind: { ja: "種類", en: "Kind" },
    description: { ja: `説明 & "引用" <script>`, en: "Description" },
    image: "assets/portfolio-preview.jpg",
    imageAlt: { ja: `画像 "代替" <説明>`, en: "Image alt" },
    action: { ja: "開く", en: "Open" },
    link: "https://example.com/project"
  };
  const rendered = renderProjectSharePage(hostileProject, 0, "ja");
  assert.match(rendered, /A &amp; &quot;B&quot; &lt;C&gt; \| himiyosh/);
  assert.match(rendered, /説明 &amp; &quot;引用&quot; &lt;script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /javascript:/i);
});

test("artifact whitelist publishes only exact share routes and sitemap excludes them", async () => {
  const [projects, whitelist, sitemap] = await Promise.all([
    readUtf8("projects.json").then(JSON.parse),
    readUtf8(".github/pages-artifact-whitelist.txt"),
    readUtf8("sitemap.xml")
  ]);
  const entries = whitelist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const expectedRoutes = projects.flatMap(({ slug }) => [
    `share/${slug}`,
    `en/share/${slug}`
  ]);

  assert.ok(entries.includes("en/index.html"));
  assert.ok(!entries.includes("en"), "English publication must not use a broad directory entry");
  assert.ok(!entries.includes("share"), "Share publication must not use a broad directory entry");
  assert.deepEqual(
    entries.filter((entry) => entry.includes("/share/") || entry.startsWith("share/")).sort(),
    expectedRoutes.sort()
  );
  for (const route of expectedRoutes) {
    assert.doesNotMatch(sitemap, new RegExp(`<loc>${canonicalRoot}${route}/</loc>`));
  }
});

