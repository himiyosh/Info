import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const pagesWhitelistPath = ".github/pages-artifact-whitelist.txt";

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function parseWhitelistEntries(sourceText) {
  return sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function topLevelPath(filePath) {
  return filePath.split("/")[0];
}

function localPathFromReference(reference) {
  if (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("mailto:") ||
    reference.startsWith("tel:") ||
    reference.startsWith("data:") ||
    reference.startsWith("javascript:")
  ) {
    return null;
  }

  if (/^https?:\/\//i.test(reference)) {
    return null;
  }

  return reference.replace(/^\.\//, "");
}

test("Pages artifact whitelist is strict and covers all locally referenced production files", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const whitelistEntries = parseWhitelistEntries(await readUtf8(pagesWhitelistPath));
  const whitelistSet = new Set(whitelistEntries);
  const expectedWhitelist = new Set([
    "index.html",
    "404.html",
    "en",
    "tokens.css",
    "styles.css",
    "modern.css",
    "script.js",
    "i18n.js",
    "projects.json",
    "assets",
    "favicon.svg",
    "robots.txt",
    "sitemap.xml",
    "ads.txt"
  ]);

  assert.deepEqual(
    [...whitelistSet].sort(),
    [...expectedWhitelist].sort(),
    "Whitelist must contain only the approved production paths"
  );
  assert.ok(whitelistSet.has("404.html"), "The custom Pages recovery document must ship");

  const localReferences = new Set();
  for (const match of indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }
  for (const match of scriptSource.matchAll(/fetch\(\s*"([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }
  for (const project of projects) {
    localReferences.add(project.image);
    localReferences.add(project.desktopImageAvif);
    localReferences.add(project.mobileImageAvif);
  }
  localReferences.add("ads.txt");

  for (const localReference of localReferences) {
    const rootPath = topLevelPath(localReference);
    assert.ok(
      whitelistSet.has(localReference) || whitelistSet.has(rootPath),
      `Referenced production file must be included by whitelist: ${localReference}`
    );
  }

  const forbiddenEntries = [
    ".github",
    "templates",
    "scripts",
    "tests",
    "README.md",
    "PRODUCT.md",
    "package.json"
  ];
  for (const forbiddenEntry of forbiddenEntries) {
    assert.ok(
      !whitelistSet.has(forbiddenEntry),
      `Whitelist must not include non-production path: ${forbiddenEntry}`
    );
  }
});

test("robots.txt and sitemap.xml are consistent", async () => {
  const robots = await readUtf8("robots.txt");
  const sitemapXml = await readUtf8("sitemap.xml");
  const indexHtml = await readUtf8("index.html");

  const canonicalHref = indexHtml.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i)?.[1];
  assert.ok(canonicalHref, "Canonical URL must be present");

  const robotsSitemapUrl = robots.match(/^\s*Sitemap:\s*(\S+)\s*$/im)?.[1];
  assert.ok(robotsSitemapUrl, "robots.txt must include a Sitemap URL");

  const expectedSitemapUrl = new URL("sitemap.xml", canonicalHref).toString();
  assert.equal(
    robotsSitemapUrl,
    expectedSitemapUrl,
    "robots.txt sitemap URL must match canonical sitemap location"
  );

  const sitemapLocs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(sitemapLocs.length > 0, "sitemap.xml must include at least one <loc>");
  assert.ok(
    sitemapLocs.includes(canonicalHref),
    "sitemap.xml must include the canonical URL listed in index.html"
  );
});
