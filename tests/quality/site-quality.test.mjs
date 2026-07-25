import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityWorkflowPath = ".github/workflows/quality-baseline.yml";
const pagesWorkflowPath = ".github/workflows/pages.yml";
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
      assert.ok(project.stack.length > 0, `Project ${index + 1} stack must not be empty when present`);
      const seenStackValues = new Set();
      for (const stackValue of project.stack) {
        assert.equal(typeof stackValue, "string", `Project ${index + 1} stack entries must be strings`);
        assert.notEqual(stackValue.trim(), "", `Project ${index + 1} stack entries must not be empty`);
        const normalizedStackValue = stackValue.trim().toLocaleLowerCase("en-US");
        assert.ok(
          !seenStackValues.has(normalizedStackValue),
          `Project ${index + 1} stack entries must be unique: ${stackValue}`
        );
        seenStackValues.add(normalizedStackValue);
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

  const alternateLinks = [...indexHtml.matchAll(
    /<link[^>]*rel="alternate"[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi
  )];
  assert.ok(alternateLinks.length >= 3, "Expected alternate language metadata links");
  const alternateMap = new Map(alternateLinks.map(([, language, href]) => [language, href]));
  assert.equal(
    alternateMap.get("ja"),
    "https://himiyosh.github.io/Info/?lang=ja",
    'hreflang="ja" URL must match the Japanese query URL'
  );
  assert.equal(
    alternateMap.get("en"),
    "https://himiyosh.github.io/Info/?lang=en",
    'hreflang="en" URL must match the English query URL'
  );
  assert.equal(
    alternateMap.get("x-default"),
    canonicalHref,
    'hreflang="x-default" URL must match canonical URL'
  );
});

test("noscript project links provide direct access to every listed project", async () => {
  const indexHtml = await readUtf8("index.html");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const noscriptContent = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1];
  assert.ok(noscriptContent, "index.html must include a noscript fallback block");

  const noscriptLinks = [...noscriptContent.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(noscriptLinks.length > 0, "noscript fallback must include direct project links");
  for (const project of projects) {
    assert.ok(
      noscriptLinks.includes(project.link),
      `noscript fallback must include direct link for project: ${project.title.en}`
    );
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

test("mobile navigation enhancement is progressive and keeps no-JS links usable", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");

  const enhancementScriptPattern =
    /<script>\s*document\.documentElement\.classList\.add\("js-enabled"\);\s*<\/script>/;
  assert.match(
    indexHtml,
    enhancementScriptPattern,
    "index.html must set js-enabled synchronously in head to avoid no-JS flash"
  );
  const enhancementScriptIndex = indexHtml.search(enhancementScriptPattern);
  const stylesheetIndex = indexHtml.indexOf('<link rel="stylesheet" href="styles.css" />');
  assert.ok(enhancementScriptIndex !== -1, "Head enhancement script must exist");
  assert.ok(stylesheetIndex !== -1, "Stylesheet link must exist");
  assert.ok(
    enhancementScriptIndex < stylesheetIndex,
    "Head enhancement script must appear before styles.css"
  );
  assert.doesNotMatch(
    scriptSource,
    /classList\.add\("js-enabled"\)/,
    "script.js should not be responsible for late js-enabled class mutation"
  );
  assert.match(
    stylesSource,
    /html:not\(\.js-enabled\)\s+\.nav-menu/,
    "styles.css must define no-JS nav menu behavior"
  );
  assert.match(
    stylesSource,
    /@media\s*\(min-width:\s*48rem\)[\s\S]*\.js-enabled\s+\.nav-menu/,
    "styles.css must provide desktop reset with js-enabled selector specificity"
  );
  assert.ok(
    /<nav[\s\S]*id="nav-menu"[\s\S]*?<a href="#about"[\s\S]*?<a href="#projects"[\s\S]*?<a href="#contact"/i.test(
      indexHtml
    ),
    "Primary nav links must be present directly in markup"
  );
});

test("new-tab links include bilingual accessibility announcement text", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");

  assert.match(
    indexHtml,
    /<a href="https:\/\/github\.com\/himiyosh" target="_blank"[\s\S]*data-i18n="accessibility\.opensInNewTab"/,
    "GitHub contact link must announce new-tab behavior via i18n text"
  );
  assert.match(
    scriptSource,
    /window\.siteI18n\.t\("accessibility\.opensInNewTab"\)/,
    "Generated project links must include localized new-tab announcement text"
  );
});

test("AdSense loader only runs when a real ad slot is present", async () => {
  const scriptSource = await readUtf8("script.js");
  assert.match(
    scriptSource,
    /ins\.adsbygoogle,\s*\[data-adsbygoogle-slot\],\s*\[data-ad-client\]/,
    "AdSense loader must detect explicit ad slots before loading third-party script"
  );
  assert.match(scriptSource, /!hasAdSlot/, "AdSense loader must short-circuit when no ad slot exists");
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

test("workflow actions are pinned to immutable Node.js-24-compatible SHAs", async () => {
  const qualityWorkflow = await readUtf8(qualityWorkflowPath);
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const expectedPins = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/upload-pages-artifact", "fc324d3547104276b827a68afc52ff2a11cc49c9"],
    ["actions/configure-pages", "45bfe0192ca1faeb007ade9deae92b16b8254a0d"],
    ["actions/deploy-pages", "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"]
  ]);

  const usesPattern = /^\s*uses:\s*([a-z0-9-]+\/[a-z0-9-]+)@([a-f0-9]{40})\s*$/gim;
  const usesByAction = new Map();
  for (const workflow of [qualityWorkflow, pagesWorkflow]) {
    for (const match of workflow.matchAll(usesPattern)) {
      usesByAction.set(match[1], match[2]);
    }
  }

  for (const [actionName, expectedSha] of expectedPins) {
    assert.equal(
      usesByAction.get(actionName),
      expectedSha,
      `Expected immutable pin for ${actionName} to be ${expectedSha}`
    );
  }

  assert.doesNotMatch(
    `${qualityWorkflow}\n${pagesWorkflow}`,
    /actions\/(?:checkout|setup-node|upload-pages-artifact|configure-pages|deploy-pages)@v\d+/i,
    "Pinned actions must not use mutable version tags"
  );
});

test("Pages workflow keeps least-privilege permissions and artifact-only deployment", async () => {
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const buildBlock = pagesWorkflow.match(/\n  build:\n([\s\S]*?)\n  deploy:\n/);
  const deployBlock = pagesWorkflow.match(/\n  deploy:\n([\s\S]*)$/);

  assert.match(
    pagesWorkflow,
    /permissions:\n\s+contents:\s+read/,
    "Workflow-level permissions must default to contents: read"
  );
  assert.ok(buildBlock, "Pages workflow must define a build job");
  assert.ok(deployBlock, "Pages workflow must define a deploy job");

  assert.match(buildBlock[1], /permissions:\n\s+contents:\s+read/, "Build job must request contents:read");
  assert.doesNotMatch(buildBlock[1], /pages:\s+write/, "Build job must not request pages:write");
  assert.doesNotMatch(buildBlock[1], /id-token:\s+write/, "Build job must not request id-token:write");
  assert.match(
    buildBlock[1],
    /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1[\s\S]*persist-credentials:\s*false/,
    "Build checkout must set persist-credentials: false"
  );
  assert.match(buildBlock[1], /timeout-minutes:\s*5/, "Build job must set a short timeout");

  assert.match(deployBlock[1], /permissions:\n\s+pages:\s+write\n\s+id-token:\s+write/, "Deploy job must request pages:write and id-token:write");
  assert.doesNotMatch(deployBlock[1], /contents:\s+write/, "Deploy job must not request contents:write");
  assert.match(deployBlock[1], /timeout-minutes:\s*5/, "Deploy job must set a short timeout");
  assert.match(
    deployBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d[\s\S]*uses:\s*actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128/,
    "Configure Pages must run in deploy immediately before deploy-pages"
  );
  assert.doesNotMatch(
    buildBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d/,
    "Build job must not run configure-pages"
  );
  assert.doesNotMatch(
    buildBlock[1],
    /uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    "Build job must not run setup-node for shell-only artifact assembly"
  );

  assert.match(
    pagesWorkflow,
    /done < \.github\/pages-artifact-whitelist\.txt/,
    "Build step must source deployment paths from the whitelist file"
  );
  assert.match(
    pagesWorkflow,
    /uses:\s*actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9[\s\S]*?path:\s*_site/,
    "Pages artifact upload must publish only the _site directory"
  );
});

test("Pages artifact whitelist is strict and covers all locally referenced production files", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const whitelistEntries = parseWhitelistEntries(await readUtf8(pagesWhitelistPath));
  const whitelistSet = new Set(whitelistEntries);
  const expectedWhitelist = new Set([
    "index.html",
    "styles.css",
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
  localReferences.add("ads.txt");

  for (const localReference of localReferences) {
    const rootPath = topLevelPath(localReference);
    assert.ok(
      whitelistSet.has(localReference) || whitelistSet.has(rootPath),
      `Referenced production file must be included by whitelist: ${localReference}`
    );
  }

  const forbiddenEntries = [".github", "tests", "README.md", "PRODUCT.md", "package.json"];
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

test("removed legacy particles file is not referenced", async () => {
  await assert.rejects(
    stat(path.join(repoRoot, "particles.json")),
    /ENOENT/,
    "particles.json should be removed from the repository root"
  );

  const sourcesToCheck = ["index.html", "script.js", "styles.css"];
  for (const sourcePath of sourcesToCheck) {
    const sourceText = await readUtf8(sourcePath);
    assert.ok(
      !/(particles\.json|particlesJS|particles\.js)/i.test(sourceText),
      `${sourcePath} must not reference legacy particles assets`
    );
  }
});

test("hero image has fetchpriority and responsive srcset sources exist", async () => {
  const indexHtml = await readUtf8("index.html");
  assert.match(
    indexHtml,
    /fetchpriority="high"/,
    "Hero image must have fetchpriority=high for LCP prioritisation"
  );

  const srcsetMatch = indexHtml.match(/srcset="([^"]+)"/);
  assert.ok(srcsetMatch, "Hero image must include a srcset attribute");
  const srcsetEntries = srcsetMatch[1].split(",").map((entry) => entry.trim());
  for (const entry of srcsetEntries) {
    const srcPath = entry.split(/\s+/)[0];
    const localPath = localPathFromReference(srcPath);
    if (localPath) {
      const fileStats = await stat(path.join(repoRoot, localPath));
      assert.ok(fileStats.isFile(), `srcset source must exist as a file: ${localPath}`);
    }
  }
});

test("hero image has no entrance animation and decorative keyframes are removed", async () => {
  const stylesSource = await readUtf8("styles.css");
  assert.doesNotMatch(
    stylesSource,
    /\.motion-ready\s+\.hero-visual\s+img\s*\{[^}]*animation:/,
    "Hero visual img must not have an entrance animation (delays LCP under throttling)"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+photo-/,
    "No photo-* keyframe animation must exist for the hero image"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+brand-marker/,
    "brand-marker keyframes must be removed (decorative GPU animation)"
  );
});

test("contact link hover transitions do not animate layout properties", async () => {
  const stylesSource = await readUtf8("styles.css");
  const contactLinkRule = stylesSource.match(/\.contact-links a\s*\{([^}]*)\}/s)?.[1];
  const contactHoverRule = stylesSource.match(/\.contact-links a:hover\s*\{([^}]*)\}/s)?.[1];
  const layoutPropertyPattern = /\b(?:padding|margin|width|height|inset|top|right|bottom|left)(?:-[a-z]+)?\b/;

  assert.ok(contactLinkRule, "Contact links must keep their base styling");
  assert.ok(contactHoverRule, "Contact links must keep a pointer hover state");
  assert.doesNotMatch(
    contactLinkRule.match(/transition\s*:[^;]+;/s)?.[0] ?? "",
    layoutPropertyPattern,
    "Contact link transitions must not animate layout properties"
  );
  assert.doesNotMatch(
    contactHoverRule,
    layoutPropertyPattern,
    "Contact link hover must not change layout properties"
  );
  assert.match(
    contactHoverRule,
    /\bbackground(?:-color)?\s*:/,
    "Contact link hover must retain a restrained color signal"
  );
});

test("project rows stay visible without per-item reveal machinery", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  assert.doesNotMatch(
    scriptSource,
    /\bprojectObserver\b|\bsetupProjectMotion\b|--project-index|classList\.add\("is-visible"\)/,
    "script.js must not restore project-row reveal state or observer wiring"
  );
  assert.doesNotMatch(
    stylesSource,
    /\.motion-ready\s+\.project-row|\.project-row(?:[^{]*?)\.is-visible|--project-index/,
    "styles.css must not hide or stagger project rows behind reveal state"
  );
});

test("Japanese hero title keeps each supplied phrase on one line", async () => {
  const stylesSource = await readUtf8("styles.css");
  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+\.hero h1\s*\{[^}]*font-size:\s*clamp\(2\.5rem,\s*6\.5vw,\s*5rem\)/s,
    "Japanese hero sizing must fit both supplied phrases across supported viewports"
  );
  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+\.hero h1 span\s*\{[^}]*white-space:\s*nowrap/s,
    "Japanese hero spans must not orphan punctuation or split a supplied phrase"
  );
});

test("pointer-tilt handler uses requestAnimationFrame to avoid forced reflow", async () => {
  const scriptSource = await readUtf8("script.js");
  assert.match(
    scriptSource,
    /requestAnimationFrame\(flushTilt\)/,
    "Pointer-tilt must schedule style writes via requestAnimationFrame"
  );
  assert.doesNotMatch(
    scriptSource,
    /getBoundingClientRect\(\)[\s\S]{0,40}tiltBounds = null/,
    "getBoundingClientRect should not be called on every pointermove; bounds must be cached"
  );
  const tiltBoundsAssign = scriptSource.match(/tiltBounds\s*=\s*heroVisual\.getBoundingClientRect\(\)/);
  const boundsNullCheck = scriptSource.match(/if\s*\(!tiltBounds\)/);
  assert.ok(
    tiltBoundsAssign && boundsNullCheck,
    "getBoundingClientRect must be guarded by a null-check (cached path)"
  );
});

test("scroll-progress feature is fully removed", async () => {
  const indexHtml = await readUtf8("index.html");
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  assert.doesNotMatch(
    indexHtml,
    /class="scroll-progress"/,
    "index.html must not contain scroll-progress markup"
  );
  assert.doesNotMatch(
    stylesSource,
    /--scroll-progress/,
    "styles.css must not reference --scroll-progress custom property"
  );
  assert.doesNotMatch(
    stylesSource,
    /--z-progress/,
    "styles.css must not reference --z-progress (used only by scroll-progress)"
  );
  assert.doesNotMatch(
    stylesSource,
    /\.scroll-progress/,
    "styles.css must not contain scroll-progress rules"
  );
  assert.doesNotMatch(
    scriptSource,
    /updateScrollProgress|progressFrame/,
    "script.js must not contain scroll-progress functions or state"
  );
});

test("hero image preload in head matches srcset/sizes of the hero img element", async () => {
  const indexHtml = await readUtf8("index.html");

  // Extract preload link attributes
  const preloadMatch = indexHtml.match(
    /<link[^>]*rel="preload"[^>]*as="image"[^>]*>/
  );
  assert.ok(
    preloadMatch,
    "index.html must include a <link rel=\"preload\" as=\"image\"> for the hero image"
  );
  const preloadTag = preloadMatch[0];

  const preloadSrcset = preloadTag.match(/imagesrcset="([^"]+)"/)?.[1];
  const preloadSizes  = preloadTag.match(/imagesizes="([^"]+)"/)?.[1];
  const preloadHref   = preloadTag.match(/href="([^"]+)"/)?.[1];
  const preloadFP     = /fetchpriority="high"/.test(preloadTag);

  assert.ok(preloadSrcset, "preload link must have imagesrcset attribute");
  assert.ok(preloadSizes,  "preload link must have imagesizes attribute");
  assert.ok(preloadHref,   "preload link must have href fallback");
  assert.ok(preloadFP,     "preload link must have fetchpriority=high");

  // Extract hero img attributes
  const imgMatch = indexHtml.match(/<img[\s\S]*?srcset="([^"]+)"[\s\S]*?sizes="([^"]+)"/);
  assert.ok(imgMatch, "Hero img must have srcset and sizes attributes");
  const [, imgSrcset, imgSizes] = imgMatch;

  assert.equal(
    preloadSrcset,
    imgSrcset,
    "preload imagesrcset must exactly match hero img srcset"
  );
  assert.equal(
    preloadSizes,
    imgSizes,
    "preload imagesizes must exactly match hero img sizes"
  );

  // Preload href must be a source listed in the srcset (no phantom fetch)
  const srcsetSources = imgSrcset.split(",").map((e) => e.trim().split(/\s+/)[0]);
  assert.ok(
    srcsetSources.includes(preloadHref),
    `preload href (${preloadHref}) must be one of the srcset sources to avoid a duplicate fetch`
  );

  // Preload must appear before the stylesheet in the source
  const preloadPos    = indexHtml.indexOf(preloadTag[0]);
  const stylesheetPos = indexHtml.indexOf('<link rel="stylesheet"');
  assert.ok(
    preloadPos < stylesheetPos,
    "preload link must appear before the stylesheet link in <head>"
  );
});
