import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("required SEO and social metadata exist and are consistent", async () => {
  const indexHtml = await readUtf8("index.html");
  const requiredPatterns = [
    /<title>[\s\S]*?<\/title>/i,
    /<meta[^>]*name="description"[^>]*>/i,
    /<meta[^>]*name="viewport"[^>]*>/i,
    /<meta[^>]*property="og:type"[^>]*>/i,
    /<meta[^>]*property="og:title"[^>]*>/i,
    /<meta[^>]*property="og:description"[^>]*>/i,
    /<meta[^>]*property="og:url"[^>]*>/i,
    /<meta[^>]*property="og:image"[^>]*>/i,
    /<meta[^>]*name="twitter:card"[^>]*>/i,
    /<meta[^>]*name="twitter:title"[^>]*>/i,
    /<meta[^>]*name="twitter:description"[^>]*>/i,
    /<meta[^>]*name="twitter:image"[^>]*>/i,
    /<link[^>]*rel="canonical"[^>]*>/i
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(pattern.test(indexHtml), `Missing required metadata pattern: ${pattern}`);
  }

  const canonicalHref = indexHtml.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i)?.[1];
  const ogUrl = indexHtml.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
  assert.ok(canonicalHref, "Canonical URL must be present");
  assert.ok(ogUrl, "og:url must be present");
  assert.equal(ogUrl, canonicalHref, "Canonical URL and og:url must match");

  const alternateLinks = [...indexHtml.matchAll(
    /<link[^>]*rel="alternate"[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi
  )];
  assert.ok(alternateLinks.length >= 3, "Expected alternate language metadata links");
  const alternateMap = new Map(alternateLinks.map(([, language, href]) => [language, href]));
  assert.equal(
    alternateMap.get("ja"),
    "https://himiyosh.github.io/Info/",
    'hreflang="ja" URL must match the Japanese stable route'
  );
  assert.equal(
    alternateMap.get("en"),
    "https://himiyosh.github.io/Info/en/",
    'hreflang="en" URL must match the English stable route'
  );
  assert.equal(
    alternateMap.get("x-default"),
    canonicalHref,
    'hreflang="x-default" URL must match canonical URL'
  );
});

test("baked project markup preserves every canonical destination in catalogue order", async () => {
  const indexHtml = await readUtf8("index.html");
  const projects = JSON.parse(await readUtf8("projects.json"));

  const cardBlocks = [...indexHtml.matchAll(
    /<article\b[^>]*\bclass="card[^"]*"[^>]*>[\s\S]*?<\/article>/gi
  )].map(([block]) => block);
  const rowBlocks = [...indexHtml.matchAll(
    /<div class="row"[^>]*>[\s\S]*?<\/div>/gi
  )].map(([block]) => block);
  assert.equal(cardBlocks.length, 3, "index.html must bake three featured cards");
  assert.equal(rowBlocks.length, 6, "index.html must bake six panel rows");

  const cardLinks = cardBlocks.map((block) =>
    [...block.matchAll(/<a class="link" href="([^"]+)"/gi)].map(([, href]) => href)
  );
  const rowLinks = rowBlocks.map((block) =>
    [...block.matchAll(/<a class="row-link" href="([^"]+)"/gi)].map(([, href]) => href)
  );

  // Primary destinations, in catalogue order, across both tiers.
  const primaryLinks = [
    ...cardLinks.map((links) => links[0]),
    ...rowLinks.map((links) => links[0])
  ];
  assert.deepEqual(
    primaryLinks,
    projects.map((project) => project.link),
    "Baked primary actions must exactly match the canonical project destinations"
  );
  assert.equal(new Set(primaryLinks).size, projects.length);

  // Featured cards expose their source repositories alongside the primary.
  assert.deepEqual(
    cardLinks.map((links) => links[1] ?? null),
    projects.slice(0, 3).map((project) => project.sourceLink ?? null)
  );

  // Panel rows are single-action by design; each carries exactly one link.
  for (const links of rowLinks) {
    assert.equal(links.length, 1);
  }
});
test("JoJo deck entries stay distinct and aligned with live deck routes", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const jojoProjects = projects.filter((project) =>
    [
      "https://himiyosh.github.io/JoJo-AIAgent/",
      "https://himiyosh.github.io/JoJo-Git/"
    ].includes(project.link)
  );
  assert.equal(jojoProjects.length, 2, "Expected exactly two separate JoJo project entries");

  const titles = new Set(jojoProjects.map((project) => project.title.en));
  assert.ok(
    titles.has("AI Agents: What Is Happening Right Now?"),
    "JoJo-AIAgent entry must use the truthful public deck title"
  );
  assert.ok(titles.has("Git, Not Scary"), "JoJo-Git entry must use the truthful public deck title");

  const links = new Set(jojoProjects.map((project) => project.link));
  assert.equal(links.size, 2, "JoJo project links must remain distinct");
  assert.ok(links.has("https://himiyosh.github.io/JoJo-AIAgent/"), "JoJo-AIAgent link must match live deck URL");
  assert.ok(links.has("https://himiyosh.github.io/JoJo-Git/"), "JoJo-Git link must match live deck URL");

  for (const project of jojoProjects) {
    assert.deepEqual(
      project.stack,
      ["Slidev", "Vue", "Playwright", "GitHub Pages"],
      `${project.title.en} stack must stay aligned with the deck implementation`
    );
  }
});


