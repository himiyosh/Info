import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function getAttribute(openingTag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attributeMatch = openingTag.match(
    new RegExp(`\\s${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i")
  );
  return attributeMatch?.[2] ?? null;
}

function getElementsById(sourceText) {
  const elementsById = new Map();
  for (const match of sourceText.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    const [openingTag, tagName] = match;
    const id = getAttribute(openingTag, "id");
    if (id) {
      elementsById.set(id, { openingTag, tagName: tagName.toLowerCase() });
    }
  }
  return elementsById;
}

function normalizeText(value) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

test("same-page anchor destinations are programmatically focusable", async () => {
  const indexHtml = await readUtf8("index.html");
  const elementsById = getElementsById(indexHtml);
  const anchorTargets = new Set(
    [...indexHtml.matchAll(/<a\b[^>]*\bhref=(["'])#([^"']+)\1[^>]*>/gi)].map(
      (match) => match[2]
    )
  );

  assert.ok(anchorTargets.has("main-content"), "Skip link must target the main landmark");
  assert.ok(anchorTargets.size > 1, "Expected same-page navigation links in index.html");

  for (const targetId of anchorTargets) {
    const target = elementsById.get(targetId);
    assert.ok(target, `Anchor target "#${targetId}" must exist`);
    assert.equal(
      getAttribute(target.openingTag, "tabindex"),
      "-1",
      `Anchor target "#${targetId}" must accept programmatic focus`
    );
  }

  const mainContent = elementsById.get("main-content");
  assert.equal(mainContent?.tagName, "main", "Skip link target must remain the main landmark");

  const sectionTargets = [...indexHtml.matchAll(/<section\b[^>]*\bid=(["'])([^"']+)\1[^>]*>/gi)];
  assert.ok(sectionTargets.length > 0, "Expected anchored content sections in index.html");
  for (const [openingTag, , sectionId] of sectionTargets) {
    assert.equal(
      getAttribute(openingTag, "tabindex"),
      "-1",
      `Section "#${sectionId}" must accept native fragment-navigation focus`
    );
  }
});

test("Projects exposes one localized focus-revealed bypass to the named Contact target", async () => {
  const [template, indexHtml, englishHtml, styles] = await Promise.all([
    readUtf8("templates/index.html"),
    readUtf8("index.html"),
    readUtf8("en/index.html"),
    readUtf8("styles.css")
  ]);

  assert.match(template, /\{\{t:projects\.skipToContact\}\}/);

  for (const [source, expectedLabel] of [
    [indexHtml, "連絡先へスキップ"],
    [englishHtml, "Skip to Contact"]
  ]) {
    const projectsSection = source.match(
      /<section\b[^>]*\bid="projects"[^>]*>([\s\S]*?)<\/section>\s*<section\b[^>]*\bid="contact"/i
    )?.[1];
    assert.ok(projectsSection, "Projects must remain directly before Contact");

    const bypassLinks = [
      ...projectsSection.matchAll(
        /(<a\b[^>]*\bclass="[^"]*\bprojects-skip-link\b[^"]*"[^>]*>)([\s\S]*?)<\/a>/gi
      )
    ];
    assert.equal(bypassLinks.length, 1, "Projects must expose one bypass link");
    assert.equal(getAttribute(bypassLinks[0][1], "href"), "#contact");
    assert.equal(getAttribute(bypassLinks[0][1], "data-i18n"), "projects.skipToContact");
    assert.equal(normalizeText(bypassLinks[0][2]), expectedLabel);
    assert.doesNotMatch(bypassLinks[0][1], /\b(?:hidden|aria-hidden)=/i);
    assert.ok(
      projectsSection.indexOf(bypassLinks[0][0]) <
        projectsSection.indexOf('id="projects-directory"'),
      "The bypass must be the first control at Projects entry"
    );
    assert.ok(
      projectsSection.indexOf(bypassLinks[0][0]) <
        projectsSection.indexOf('id="projects-container"'),
      "Dynamic project replacement must not own the bypass"
    );
    assert.ok(
      projectsSection.indexOf(bypassLinks[0][0]) <
        projectsSection.indexOf('id="projects-fallback"'),
      "Fallback visibility changes must not own the bypass"
    );

    const elementsById = getElementsById(source);
    const contact = elementsById.get("contact");
    assert.equal(contact?.tagName, "section");
    assert.equal(getAttribute(contact.openingTag, "tabindex"), "-1");
    assert.equal(getAttribute(contact.openingTag, "aria-labelledby"), "contact-title");
    assert.equal(elementsById.get("contact-title")?.tagName, "h2");

    const ids = [...source.matchAll(/\sid=(["'])([^"']+)\1/gi)].map((match) => match[2]);
    assert.equal(ids.length, new Set(ids).size, "Generated pages must not contain duplicate IDs");
  }

  assert.match(
    styles,
    /\.skip-link\s*\{[^}]*max-inline-size:\s*calc\(100%\s*-\s*var\(--space-lg\)\);[^}]*min-height:\s*44px;[^}]*display:\s*flex;[^}]*align-items:\s*center;/s
  );
  assert.match(styles, /\.skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\);/s);
  assert.match(
    styles,
    /:where\(a,\s*button\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--color-focus\);/s
  );
  assert.match(
    styles,
    /\.contact:focus\s+\.contact-panel\s*\{[^}]*outline:\s*3px solid var\(--color-focus\);[^}]*outline-offset:\s*3px;/s
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.skip-link\s*\{[^}]*transition:\s*none !important;/s
  );
});
