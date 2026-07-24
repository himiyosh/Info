import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function flattenStringLeafKeys(value, prefix = "") {
  if (typeof value === "string") {
    return [prefix];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenStringLeafKeys(child, nextPrefix);
  });
}

function getByPath(value, keyPath) {
  return keyPath.split(".").reduce((current, key) => current?.[key], value);
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

function extractObjectLiteral(sourceText, declarationPrefix) {
  const declarationIndex = sourceText.indexOf(declarationPrefix);
  if (declarationIndex === -1) {
    throw new Error(`Could not find declaration prefix: ${declarationPrefix}`);
  }

  const objectStart = sourceText.indexOf("{", declarationIndex);
  if (objectStart === -1) {
    throw new Error(`Could not find object literal for declaration: ${declarationPrefix}`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = objectStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    const previous = sourceText[index - 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (previous === "*" && char === "/") {
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (char === "/" && next === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (inSingle) {
      if (char === "'" && previous !== "\\") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '"' && previous !== "\\") {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === "`" && previous !== "\\") {
        inTemplate = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === "`") {
      inTemplate = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return sourceText.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error(`Could not close object literal for declaration: ${declarationPrefix}`);
}

async function listFilesRecursively(rootDirectory) {
  const results = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursively(absolutePath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(absolutePath);
    }
  }

  return results;
}

test("JavaScript files are parseable", async () => {
  const javascriptFiles = ["i18n.js", "script.js"];
  for (const filePath of javascriptFiles) {
    const sourceText = await readUtf8(filePath);
    assert.doesNotThrow(() => {
      new vm.Script(sourceText, { filename: filePath });
    });
  }
});

test("projects.json schema, localization, links, and preview assets are valid", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  assert.ok(Array.isArray(projects), "projects.json must be an array");
  assert.ok(projects.length > 0, "projects.json must contain at least one project");

  const localizedFields = ["title", "kind", "description", "action", "imageAlt"];
  const requiredStringFields = ["link", "image"];
  const seenLinks = new Set();
  const seenImages = new Set();

  for (const [index, project] of projects.entries()) {
    assert.equal(typeof project, "object", `Project ${index + 1} must be an object`);
    assert.ok(project, `Project ${index + 1} must not be null`);

    for (const field of localizedFields) {
      const localized = project[field];
      assert.equal(typeof localized, "object", `Project ${index + 1} field "${field}" must be localized`);
      assert.ok(localized, `Project ${index + 1} field "${field}" must exist`);
      for (const language of ["ja", "en"]) {
        assert.equal(
          typeof localized[language],
          "string",
          `Project ${index + 1} field "${field}.${language}" must be a string`
        );
        assert.notEqual(
          localized[language].trim(),
          "",
          `Project ${index + 1} field "${field}.${language}" must not be empty`
        );
      }
    }

    for (const field of requiredStringFields) {
      assert.equal(typeof project[field], "string", `Project ${index + 1} field "${field}" must be a string`);
      assert.notEqual(project[field].trim(), "", `Project ${index + 1} field "${field}" must not be empty`);
    }

    const linkUrl = new URL(project.link);
    assert.ok(
      linkUrl.protocol === "http:" || linkUrl.protocol === "https:",
      `Project ${index + 1} link must use http/https`
    );
    assert.ok(!seenLinks.has(project.link), `Duplicate project link found: ${project.link}`);
    seenLinks.add(project.link);

    assert.ok(!/^https?:\/\//i.test(project.image), `Project ${index + 1} image must be local: ${project.image}`);
    assert.ok(!seenImages.has(project.image), `Duplicate project image found: ${project.image}`);
    seenImages.add(project.image);

    const imagePath = path.join(repoRoot, project.image);
    const imageStats = await stat(imagePath);
    assert.ok(imageStats.isFile(), `Project image must exist as a file: ${project.image}`);

    if (Object.hasOwn(project, "stack")) {
      assert.ok(Array.isArray(project.stack), `Project ${index + 1} stack must be an array when present`);
      for (const stackValue of project.stack) {
        assert.equal(typeof stackValue, "string", `Project ${index + 1} stack entries must be strings`);
        assert.notEqual(stackValue.trim(), "", `Project ${index + 1} stack entries must not be empty`);
      }
    }
  }
});

test("i18n key parity and index.html data-i18n references are complete", async () => {
  const i18nSource = await readUtf8("i18n.js");
  const translationLiteral = extractObjectLiteral(i18nSource, "const translations =");
  const translations = vm.runInNewContext(`(${translationLiteral})`, Object.create(null), {
    timeout: 1000
  });

  const jaKeys = new Set(flattenStringLeafKeys(translations.ja));
  const enKeys = new Set(flattenStringLeafKeys(translations.en));

  assert.deepEqual(
    [...jaKeys].sort(),
    [...enKeys].sort(),
    "Japanese and English translation key sets must match"
  );

  const indexHtml = await readUtf8("index.html");
  const attributePatterns = [
    /data-i18n="([^"]+)"/g,
    /data-i18n-content="([^"]+)"/g,
    /data-i18n-alt="([^"]+)"/g,
    /data-i18n-aria-label="([^"]+)"/g
  ];

  const referencedKeys = new Set();
  for (const pattern of attributePatterns) {
    for (const match of indexHtml.matchAll(pattern)) {
      referencedKeys.add(match[1]);
    }
  }

  for (const key of referencedKeys) {
    assert.equal(typeof getByPath(translations.ja, key), "string", `Missing ja translation for "${key}"`);
    assert.equal(typeof getByPath(translations.en, key), "string", `Missing en translation for "${key}"`);
  }
});

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
});

test("index.html IDs are unique and internal anchors are valid", async () => {
  const indexHtml = await readUtf8("index.html");
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, "All id attributes in index.html must be unique");

  const internalAnchors = [...indexHtml.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]);
  for (const anchorTarget of internalAnchors) {
    assert.ok(uniqueIds.has(anchorTarget), `Anchor target "#${anchorTarget}" does not exist`);
  }
});

test("all referenced local files exist", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));

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
  }

  for (const localReference of localReferences) {
    const fileStats = await stat(path.join(repoRoot, localReference));
    assert.ok(fileStats.isFile(), `Missing referenced local file: ${localReference}`);
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

test("preview assets are not stale or orphaned", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const assetRoot = path.join(repoRoot, "assets");
  const assetFiles = (await listFilesRecursively(assetRoot)).map((absolutePath) =>
    path.relative(repoRoot, absolutePath).split(path.sep).join("/")
  );

  const projectImages = projects.map((project) => project.image);
  const previewFiles = assetFiles.filter((filePath) => /-preview\.[a-z0-9]+$/i.test(filePath));
  assert.ok(previewFiles.length > 0, "At least one preview asset must exist");

  for (const previewPath of previewFiles) {
    const usageCount = projectImages.filter((imagePath) => imagePath === previewPath).length;
    assert.equal(usageCount, 1, `Preview asset must be referenced exactly once: ${previewPath}`);
  }

  const orphanProjectImages = projectImages.filter((imagePath) => !assetFiles.includes(imagePath));
  assert.equal(
    orphanProjectImages.length,
    0,
    `All project images must exist under assets/: ${orphanProjectImages.join(", ")}`
  );
});
