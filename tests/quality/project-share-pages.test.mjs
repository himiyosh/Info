import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { translations } = require("../../i18n.js");
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] : undefined;
}

function normalizeText(value) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
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

function externalActionPattern(variant, href, label, opensInNewTab) {
  return new RegExp(
    [
      `<a class="share-project-link share-project-link--${variant}"`,
      ` href="${escapeRegExp(escapeHtml(href))}"`,
      ` target="_blank" rel="noopener noreferrer">`,
      `\\s*<span>${escapeRegExp(escapeHtml(label))}</span>`,
      `\\s*<span class="sr-only">${escapeRegExp(escapeHtml(opensInNewTab))}</span>`,
      `\\s*<span aria-hidden="true">↗</span>`,
      `\\s*</a>`
    ].join("")
  );
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
  const scriptSource = await readUtf8("script.js");
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
  assert.match(scriptSource, /createProjectShareUrl\(\s*project\.slug,/);
});

test("every project has exact Japanese and English share-page metadata and fallback content", async () => {
  const { renderProjectSharePage } = await import(
    `../../scripts/generate-static-pages.mjs?share-context=${Date.now()}`
  );
  const projects = JSON.parse(await readUtf8("projects.json"));
  const sourceCoverage = { ja: 0, en: 0 };
  const proofCoverage = { ja: 0, en: 0 };
  const languageLinkInventory = [];

  for (const [projectIndex, project] of projects.entries()) {
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

      assert.equal(
        page,
        renderProjectSharePage(project, projectIndex, language),
        `${routePath} must be the deterministic canonical render`
      );
      assert.match(page, /Generated from templates\/share\.html and projects\.json/);
      assert.match(page, new RegExp(`<html lang="${language}"`));
      assert.match(page, new RegExp(`<title>${escapeRegExp(escapeHtml(project.title[language]))} \\| himiyosh</title>`));
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
      const languageNavigation = page.match(
        /(<nav\b(?=[^>]*\bclass="[^"]*\bshare-language-navigation\b[^"]*")[^>]*>)([\s\S]*?)<\/nav>/i
      );
      assert.ok(languageNavigation, `${routePath} must expose visible language navigation`);
      assert.equal(
        attributeValue(languageNavigation[1], "aria-label"),
        translations[language].nav.switchLanguage
      );
      const languageLinks = [...languageNavigation[2].matchAll(
        /(<a\b(?=[^>]*\bclass="[^"]*\bshare-language-link\b[^"]*")[^>]*>)([\s\S]*?)<\/a>/gi
      )];
      assert.equal(languageLinks.length, 1, `${routePath} must expose one language link`);
      const [, languageLinkOpeningTag, languageLinkBody] = languageLinks[0];
      const targetLabel = languageLinkBody.match(/(<span\b[^>]*>)([\s\S]*?)<\/span>/i);
      assert.ok(targetLabel, `${routePath} must mark the visible target-language label`);
      assert.equal(attributeValue(languageLinkOpeningTag, "lang"), undefined);
      assert.equal(attributeValue(languageLinkOpeningTag, "hreflang"), alternateLanguage);
      assert.equal(
        attributeValue(languageLinkOpeningTag, "href"),
        `${canonicalRoot}${alternateRoutePath}`
      );
      assert.equal(attributeValue(targetLabel[1], "lang"), alternateLanguage);
      assert.equal(normalizeText(targetLabel[2]), translations[language].nav.toggleShort);
      assert.doesNotMatch(attributeValue(languageLinkOpeningTag, "href"), /[?#]/);
      assert.doesNotMatch(languageNavigation[0], /[\u{1F1E6}-\u{1F1FF}]/u);
      assert.doesNotMatch(languageLinkOpeningTag, /\b(?:data-|onclick)\b/i);
      assert.doesNotMatch(page, /<script\b/i);
      assert.doesNotMatch(
        page,
        /\b(?:localStorage|sessionStorage|navigator\.languages?|location\.(?:assign|replace)|http-equiv=["']refresh)/i
      );
      languageLinkInventory.push({
        from: routePath,
        href: `${canonicalRoot}${alternateRoutePath}`,
        label: translations[language].nav.toggleShort,
        lang: alternateLanguage,
        hreflang: alternateLanguage
      });
      assert.match(page, new RegExp(`<h1[^>]*>${escapeRegExp(escapeHtml(project.title[language]))}</h1>`));
      assert.match(page, new RegExp(`<p class="share-project-kind">${escapeRegExp(escapeHtml(project.kind[language]))}</p>`));
      assert.match(page, new RegExp(`<p class="share-project-description">${escapeRegExp(escapeHtml(project.description[language]))}</p>`));
      assert.match(
        page,
        new RegExp(`<img[^>]*src="[^"]*${escapeRegExp(project.image)}"[^>]*alt="${escapeRegExp(escapeHtml(project.imageAlt[language]))}"[^>]*width="960"[^>]*height="540"`)
      );
      assert.match(page, new RegExp(`href="${escapeRegExp(portfolioUrl)}"`));
      assert.match(
        page,
        externalActionPattern(
          "primary",
          project.link,
          project.action[language],
          translations[language].accessibility.opensInNewTab
        )
      );

      if (project.sourceAction && project.sourceLink) {
        sourceCoverage[language] += 1;
        assert.match(
          page,
          externalActionPattern(
            "source",
            project.sourceLink,
            project.sourceAction[language],
            translations[language].accessibility.opensInNewTab
          )
        );
      } else {
        assert.doesNotMatch(page, /share-project-link--source/);
      }

      if (project.proof && project.proofLink) {
        proofCoverage[language] += 1;
        assert.match(
          page,
          new RegExp(
            `<section class="share-project-proof"[^>]*>[\\s\\S]*` +
              `<span class="share-project-proof-label"[^>]*>` +
              `${escapeRegExp(escapeHtml(translations[language].projects.proofLabel))}</span>[\\s\\S]*` +
              `<span class="share-project-proof-statement">` +
              `${escapeRegExp(escapeHtml(project.proof[language]))}</span>[\\s\\S]*` +
              externalActionPattern(
                "evidence",
                project.proofLink,
                translations[language].projects.proofAction,
                translations[language].accessibility.opensInNewTab
              ).source +
              `[\\s\\S]*</section>`
          )
        );
      } else {
        assert.doesNotMatch(page, /share-project-proof|share-project-link--evidence/);
      }
    }
  }

  assert.equal(projects.length, 9);
  assert.equal(languageLinkInventory.length, 18);
  assert.deepEqual(
    languageLinkInventory,
    projects.flatMap(({ slug }) => [
      {
        from: `share/${slug}/`,
        href: `${canonicalRoot}en/share/${slug}/`,
        label: translations.ja.nav.toggleShort,
        lang: "en",
        hreflang: "en"
      },
      {
        from: `en/share/${slug}/`,
        href: `${canonicalRoot}share/${slug}/`,
        label: translations.en.nav.toggleShort,
        lang: "ja",
        hreflang: "ja"
      }
    ])
  );
  assert.deepEqual(sourceCoverage, { ja: 6, en: 6 });
  assert.deepEqual(proofCoverage, { ja: 8, en: 8 });

  const privateProject = projects.find(({ slug }) => slug === "ucfitness");
  assert.ok(privateProject);
  assert.equal(Object.hasOwn(privateProject, "sourceAction"), false);
  assert.equal(Object.hasOwn(privateProject, "sourceLink"), false);
  assert.equal(Object.hasOwn(privateProject, "proof"), false);
  assert.equal(Object.hasOwn(privateProject, "proofLink"), false);
});

test("share-page generator exposes exact inventory, stale detection, escaped context, and pair validation", async () => {
  const { findStaleShareOutputs, renderProjectSharePage, sharePages } = await import(
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
  assert.deepEqual(
    findStaleShareOutputs(
      [...expectedPaths, "share/retired-project/index.html"],
      expectedPaths
    ),
    ["share/retired-project/index.html"]
  );

  const hostileProject = {
    slug: "safe-slug",
    title: { ja: `A & "B" <C> {{siteRoot}}`, en: "Safe" },
    kind: { ja: "種類", en: "Kind" },
    description: { ja: `説明 & "引用" <script>`, en: "Description" },
    image: "assets/portfolio-preview.jpg",
    imageAlt: { ja: `画像 "代替" <説明>`, en: "Image alt" },
    action: { ja: "開く", en: "Open" },
    link: "https://example.com/project",
    sourceAction: { ja: `ソース & "表示" <確認>`, en: "View source" },
    sourceLink: `https://example.com/source?query="<source>"&mode='safe'`,
    proof: { ja: `根拠 & "引用" <確認>`, en: "Evidence" },
    proofLink:
      "https://github.com/example/public-repo/blob/0123456789abcdef0123456789abcdef01234567/README.md#L1-L2"
  };
  const rendered = renderProjectSharePage(hostileProject, 0, "ja");
  assert.match(rendered, /A &amp; &quot;B&quot; &lt;C&gt; \{\{siteRoot\}\} \| himiyosh/);
  assert.doesNotMatch(rendered, /A &amp; &quot;B&quot; &lt;C&gt; \.\.\//);
  assert.match(rendered, /説明 &amp; &quot;引用&quot; &lt;script&gt;/);
  assert.match(rendered, /ソース &amp; &quot;表示&quot; &lt;確認&gt;/);
  assert.match(rendered, /根拠 &amp; &quot;引用&quot; &lt;確認&gt;/);
  assert.match(
    rendered,
    /href="https:\/\/example\.com\/source\?query=&quot;&lt;source&gt;&quot;&amp;mode=&#39;safe&#39;"/
  );
  assert.match(rendered, /href="https:\/\/github\.com\/example\/public-repo\/blob\/0123456789abcdef0123456789abcdef01234567\/README\.md#L1-L2"/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /javascript:/i);

  const sourceWithoutLink = structuredClone(hostileProject);
  delete sourceWithoutLink.sourceLink;
  assert.throws(
    () => renderProjectSharePage(sourceWithoutLink, 0, "ja"),
    /sourceAction and sourceLink.+provided together/
  );

  const proofWithoutText = structuredClone(hostileProject);
  delete proofWithoutText.proof;
  assert.throws(
    () => renderProjectSharePage(proofWithoutText, 0, "ja"),
    /proof and proofLink.+provided together/
  );

  assert.throws(
    () =>
      renderProjectSharePage(
        { ...hostileProject, sourceLink: "javascript:alert(1)" },
        0,
        "ja"
      ),
    /sourceLink.+unsupported protocol/
  );
});

test("share language and trust context stay distinct within the responsive Graphite Blue layout", async () => {
  const [template, stylesheet] = await Promise.all([
    readUtf8("templates/share.html"),
    readUtf8("share.css")
  ]);

  const languageNavigationIndex = template.indexOf(
    '<nav class="share-language-navigation"'
  );
  assert.ok(languageNavigationIndex > -1);
  assert.ok(languageNavigationIndex < template.indexOf("<article"));
  assert.match(
    template,
    /<nav class="share-language-navigation" aria-label="\{\{languageNavigationLabel\}\}">/
  );
  assert.match(
    template,
    /<a class="share-language-link" href="\{\{alternateUrl\}\}" hreflang="\{\{alternateLanguage\}\}">/
  );
  assert.match(
    template,
    /<span lang="\{\{alternateLanguage\}\}">\{\{languageToggleShort\}\}<\/span>/
  );
  const projectActions = template.match(
    /<nav class="share-project-actions"[\s\S]*?<\/nav>/
  )?.[0];
  assert.ok(projectActions);
  assert.doesNotMatch(projectActions, /share-language/);
  assert.match(template, /^\s*\{\{sourceActionMarkup\}\}\s*$/m);
  assert.match(template, /^\s*\{\{proofMarkup\}\}\s*$/m);
  assert.match(
    stylesheet,
    /\.share-page\s*\{[^}]*display:\s*grid;[^}]*align-content:\s*center;[^}]*gap:\s*var\(--space-sm\);/
  );
  assert.match(
    stylesheet,
    /\.share-language-navigation\s*\{[^}]*min-width:\s*0;[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/
  );
  assert.match(
    stylesheet,
    /\.share-project-link,\s*\.share-language-link\s*\{[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/
  );
  assert.match(
    stylesheet,
    /\.share-language-link\s*\{[^}]*min-width:\s*44px;[^}]*max-width:\s*100%;/
  );
  assert.match(
    stylesheet,
    /\.share-project-link:focus-visible,\s*\.share-language-link:focus-visible\s*\{[^}]*outline:\s*var\(--rule-strong\) solid var\(--color-focus\);[^}]*outline-offset:\s*var\(--space-3xs\);/
  );
  assert.match(stylesheet, /html,\s*body\s*\{[^}]*overflow-x:\s*clip;/);
  assert.match(stylesheet, /\.share-project-proof\s*\{/);
  assert.match(stylesheet, /\.share-project-proof-statement\s*\{/);
  assert.match(stylesheet, /\.share-project-link--evidence\s*\{/);
  assert.match(stylesheet, /\.share-project-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(stylesheet, /@media \(min-width:\s*48rem\)/);
});

test("artifact whitelist publishes only exact share routes and sitemap excludes them", async () => {
  const [projects, whitelist, sitemap, workflow] = await Promise.all([
    readUtf8("projects.json").then(JSON.parse),
    readUtf8(".github/pages-artifact-whitelist.txt"),
    readUtf8("sitemap.xml"),
    readUtf8(".github/workflows/pages.yml")
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
  assert.match(
    workflow,
    /mkdir -p "_site\/\$\(dirname "\$artifact_path"\)"\s+cp -R "\$artifact_path" "_site\/\$artifact_path"/
  );
});
