import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pages, renderPage } from "../../scripts/generate-static-pages.mjs";

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("mobile hero exposes both direct actions before profile media in canonical and localized markup", async () => {
  const template = await readUtf8("templates/index.html");
  const sources = [["templates/index.html", template]];

  for (const page of pages) {
    const generated = await readUtf8(page.outputPath);
    assert.equal(generated, renderPage(template, page), `${page.outputPath} must not drift`);
    sources.push([page.outputPath, generated]);
  }

  for (const [label, source] of sources) {
    const hero = sourceBetween(source, '<section class="hero"', "\n    </section>");
    const stageIndex = hero.indexOf('<div class="hero-stage">');
    const supportIndex = hero.indexOf('<div class="hero-support">');
    const projectsIndex = hero.indexOf('href="#projects"');
    const contactIndex = hero.indexOf('href="#contact"');
    const visualIndex = hero.indexOf('<figure class="hero-visual">');

    assert.ok(stageIndex >= 0, `${label} must keep the hero title stage`);
    assert.ok(supportIndex >= 0, `${label} must keep hero support`);
    assert.ok(projectsIndex >= 0, `${label} must keep the Projects action`);
    assert.ok(contactIndex >= 0, `${label} must keep the Contact action`);
    assert.ok(visualIndex >= 0, `${label} must keep profile media`);
    assert.ok(
      stageIndex < supportIndex &&
        supportIndex < projectsIndex &&
        projectsIndex < contactIndex &&
        contactIndex < visualIndex,
      `${label} must read title, support/actions, then profile media on mobile`
    );
  }

  assert.match(
    template,
    /<link\s+rel="preload"[\s\S]*?as="image"[\s\S]*?fetchpriority="high"\s*\/>/
  );
  assert.match(
    template,
    /<img[\s\S]*?width="960"[\s\S]*?height="720"[\s\S]*?fetchpriority="high"[\s\S]*?data-i18n-alt="hero\.imageAlt"/
  );
});

test("the 48rem Feature Stack keeps title and support left with profile media right", async () => {
  const modern = await readUtf8("modern.css");
  const desktop = sourceBetween(
    modern,
    "@media (min-width: 48rem)",
    "\nhtml:not(.js-enabled) .hero"
  );

  assert.match(
    desktop,
    /\.hero-sticky\s*\{[^}]*grid-template-areas:\s*"stage visual"\s*"support visual";/s
  );
  assert.match(desktop, /\.hero-stage\s*\{\s*grid-area:\s*stage;\s*\}/s);
  assert.match(desktop, /\.hero-support\s*\{\s*grid-area:\s*support;\s*\}/s);
  assert.match(desktop, /\.hero-visual\s*\{\s*grid-area:\s*visual;\s*\}/s);
});
