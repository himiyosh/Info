import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const qualityWorkflowPath = ".github/workflows/quality-baseline.yml";
const pagesWorkflowPath = ".github/workflows/pages.yml";
const pagesWhitelistPath = ".github/pages-artifact-whitelist.txt";
const translatedStaticAttributes = [
  ["data-i18n-content", "content"],
  ["data-i18n-alt", "alt"],
  ["data-i18n-aria-label", "aria-label"]
];
const namedHtmlEntities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", "\""]
]);

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

function parseTranslations(sourceText) {
  const translationLiteral = extractObjectLiteral(sourceText, "const translations =");
  return vm.runInNewContext(`(${translationLiteral})`, Object.create(null), {
    timeout: 1000
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readHtmlAttribute(tag, attribute) {
  const attributePattern = new RegExp(
    `\\s${escapeRegExp(attribute)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const match = tag.match(attributePattern);
  return match ? match[1] ?? match[2] : undefined;
}

function decodeHtmlEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal, hexadecimal, named) => {
      if (named) {
        return namedHtmlEntities.get(named.toLowerCase()) ?? entity;
      }

      const codePoint = Number.parseInt(
        decimal ?? hexadecimal,
        decimal === undefined ? 16 : 10
      );
      return codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    }
  );
}

function normalizeHtmlWhitespace(value) {
  return value
    .replace(/[\t\n\f\r ]+/g, " ")
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
}

function normalizeStaticFallback(value) {
  return normalizeHtmlWhitespace(decodeHtmlEntities(value.replace(/<[^>]*>/g, "")));
}

function extractStaticI18nFallbacks(sourceText) {
  const fallbacks = [];

  for (const openingTagMatch of sourceText.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const [openingTag, tagName] = openingTagMatch;
    const textKey = readHtmlAttribute(openingTag, "data-i18n");
    if (textKey !== undefined) {
      const contentStart = openingTagMatch.index + openingTag.length;
      const closingTagPattern = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "gi");
      closingTagPattern.lastIndex = contentStart;
      const closingTagMatch = closingTagPattern.exec(sourceText);
      fallbacks.push({
        marker: "data-i18n",
        target: "text content",
        key: textKey,
        value: closingTagMatch
          ? sourceText.slice(contentStart, closingTagMatch.index)
          : undefined
      });
    }

    for (const [marker, target] of translatedStaticAttributes) {
      const key = readHtmlAttribute(openingTag, marker);
      if (key !== undefined) {
        fallbacks.push({
          marker,
          target,
          key,
          value: readHtmlAttribute(openingTag, target)
        });
      }
    }
  }

  return fallbacks;
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

test("i18n key parity, references, and Japanese static fallbacks are complete", async () => {
  const i18nSource = await readUtf8("i18n.js");
  const translations = parseTranslations(i18nSource);

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

  const staticFallbacks = extractStaticI18nFallbacks(indexHtml);
  const requiredMarkers = [
    "data-i18n",
    "data-i18n-content",
    "data-i18n-alt",
    "data-i18n-aria-label"
  ];
  for (const marker of requiredMarkers) {
    assert.ok(
      staticFallbacks.some((fallback) => fallback.marker === marker),
      `index.html must contain a ${marker} fallback`
    );
  }

  for (const { key, marker, target, value } of staticFallbacks) {
    const japaneseTranslation = getByPath(translations.ja, key);
    assert.equal(
      typeof japaneseTranslation,
      "string",
      `Missing ja translation for static ${marker} key "${key}"`
    );
    assert.notEqual(
      value,
      undefined,
      `Static ${target} fallback for "${key}" must be present`
    );
    assert.equal(
      normalizeStaticFallback(value),
      normalizeHtmlWhitespace(japaneseTranslation),
      `Static ${target} fallback for "${key}" must match its Japanese translation`
    );
  }
});

test("Japanese running prose uses progressive phrase-aware line breaking", async () => {
  const stylesSource = await readUtf8("styles.css");
  const fallbackRule = stylesSource.match(
    /html:lang\(ja\)\s+:where\(\s*\.hero-lede,[\s\S]*?\.footer-disclaimer\s*\)\s*\{([^}]*)\}/
  );

  assert.ok(fallbackRule, "Japanese running prose must have an explicit fallback rule");
  assert.match(
    fallbackRule[1],
    /line-break:\s*strict/,
    "Japanese running prose must use strict Japanese line-breaking rules"
  );
  assert.match(
    fallbackRule[1],
    /word-break:\s*normal/,
    "Japanese running prose must retain a safe word-break fallback"
  );
  assert.match(
    stylesSource,
    /@supports\s*\(word-break:\s*auto-phrase\)\s*\{[\s\S]*?html:lang\(ja\)\s+:where\([\s\S]*?\.footer-disclaimer\s*\)\s*\{[^}]*word-break:\s*auto-phrase/,
    "Japanese running prose must progressively enable auto-phrase where supported"
  );
  assert.doesNotMatch(
    fallbackRule[0],
    /(?:^|[\s,.])(a|button|h[1-6]|code|\.project-stack)(?:[\s,.)]|$)/,
    "Phrase-aware wrapping must not target links, controls, headings, code, or stack text"
  );
});

test("protected Japanese phrase boundaries match between static and translated copy", async () => {
  const indexHtml = await readUtf8("index.html");
  const i18nSource = await readUtf8("i18n.js");
  const translations = parseTranslations(i18nSource);
  const expectedHero =
    "課題を解き、学びを分かち合う。好奇心を実用へつなぐ、himiyosh\u00a0のポートフォリオです。";
  const expectedAbout =
    "某グローバルIT企業で、テクノロジー領域の課題解決に取り組\u2060んでいます。役に立つ知識や技術を見つけ、試し、分かりやすい形にすることが好きです。";

  assert.match(
    indexHtml,
    /課題を解き、学びを分かち合う。好奇心を実用へつなぐ、himiyosh&nbsp;のポートフォリオです。/,
    "Static hero copy must protect the himiyosh の boundary with an NBSP"
  );
  assert.match(
    indexHtml,
    /取り組&#8288;んでいます/,
    "Static About copy must protect the observed Japanese phrase boundary with a word joiner"
  );
  assert.equal(
    translations.ja.hero.lede,
    expectedHero,
    "Translated hero copy must match the rendered static copy"
  );
  assert.equal(
    translations.ja.about.content,
    expectedAbout,
    "Translated About copy must match the rendered static copy"
  );
});

test("rejected continuous curiosity field recovery remains absent", async () => {
  const productionPaths = ["index.html", "i18n.js", "styles.css", "script.js"];
  const rejectedPatterns = [
    /curiosity-field/i,
    /initializeCuriosityField/,
    /requestAnimationFrame\s*\(\s*renderField\s*\)/
  ];

  for (const sourcePath of productionPaths) {
    const sourceText = await readUtf8(sourcePath);
    for (const rejectedPattern of rejectedPatterns) {
      assert.doesNotMatch(
        sourceText,
        rejectedPattern,
        `${sourcePath} must not restore the rejected continuous curiosity field`
      );
    }
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
  assert.match(
    stylesSource,
    /\.js-enabled\s+\.nav-menu\s*\{[\s\S]*?visibility:\s*hidden[\s\S]*?visibility\s+0s\s+linear\s+var\(--dur-short\)/,
    "Closed enhanced navigation must become hidden after its exit animation"
  );
  assert.match(
    stylesSource,
    /\.js-enabled\s+\.nav-menu\.active\s*\{[\s\S]*?visibility:\s*visible[\s\S]*?transition-delay:\s*0s/,
    "Opened enhanced navigation must become immediately visible before it receives focus"
  );
  const desktopNavOverride = stylesSource.match(
    /@media\s*\(min-width:\s*48rem\)\s*\{[\s\S]*?\.js-enabled\s+\.nav-menu,\s*\.nav-menu\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(desktopNavOverride, "Desktop navigation override must exist");
  assert.match(
    desktopNavOverride,
    /visibility:\s*visible/,
    "Desktop navigation override must reset mobile disclosure visibility"
  );
  assert.ok(
    /<nav[\s\S]*id="nav-menu"[\s\S]*?<a href="#about"[\s\S]*?<a href="#projects"[\s\S]*?<a href="#contact"/i.test(
      indexHtml
    ),
    "Primary nav links must be present directly in markup"
  );
});

test("open mobile navigation wraps keyboard focus at its disclosure boundaries", async () => {
  const scriptSource = await readUtf8("script.js");

  assert.match(
    scriptSource,
    /function isMobileMenuActive\(\)\s*\{[\s\S]*mobileNavigation\.matches[\s\S]*navMenu\.classList\.contains\("active"\)[\s\S]*hamburgerMenu\.getAttribute\("aria-expanded"\)\s*===\s*"true"/,
    "Focus containment must be limited to the active, expanded mobile navigation"
  );
  assert.match(
    scriptSource,
    /if\s*\(event\.key\s*!==\s*"Tab"\s*\|\|\s*!isMobileMenuActive\(\)\)\s*\{\s*return;/,
    "Non-Tab keys and inactive or desktop navigation must bypass focus containment"
  );
  assert.match(
    scriptSource,
    /navMenu\.querySelectorAll\(menuFocusableSelector\)/,
    "Focus containment must derive enabled menu controls in DOM order"
  );
  assert.match(
    scriptSource,
    /!element\.matches\(":disabled"\)[\s\S]*element\.getAttribute\("aria-disabled"\)\s*!==\s*"true"/,
    "Native-disabled and aria-disabled menu controls must be excluded from the focus cycle"
  );
  assert.match(
    scriptSource,
    /event\.shiftKey\s*&&\s*document\.activeElement\s*===\s*hamburgerMenu[\s\S]*event\.preventDefault\(\);[\s\S]*lastMenuControl\.focus\(\);/,
    "Shift+Tab from the disclosure toggle must wrap to the last menu control"
  );
  assert.match(
    scriptSource,
    /!event\.shiftKey\s*&&\s*document\.activeElement\s*===\s*lastMenuControl[\s\S]*event\.preventDefault\(\);[\s\S]*hamburgerMenu\.focus\(\);/,
    "Tab from the last menu control must wrap to the disclosure toggle"
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

test("workflow checkouts do not persist credentials", async () => {
  for (const [workflowName, workflowPath] of [
    ["Quality", qualityWorkflowPath],
    ["Pages", pagesWorkflowPath]
  ]) {
    const workflow = await readUtf8(workflowPath);
    assert.match(
      workflow,
      /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s*\n\s*with:\s*\n\s+persist-credentials:\s*false/,
      `${workflowName} checkout must set persist-credentials: false`
    );
  }
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
    "tokens.css",
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

test("project rows stay visible by default and reveal machinery is bounded and safe", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  // Base state: every row is visible with zero JS dependency. No rule
  // outside a .js-enabled + no-preference guard may set opacity/transform
  // on .project-row.
  assert.match(
    stylesSource,
    /\.project-row\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s,
    ".project-row base rule must default to fully visible with no transform"
  );

  const primingRule = stylesSource.match(
    /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.js-enabled\s+\.project-row\s*\{([^}]*)\}\s*\.js-enabled\s+\.project-row\.is-priming\s*\{([^}]*)\}/s
  );
  assert.ok(
    primingRule,
    "The priming/reveal transition must be scoped to .js-enabled AND prefers-reduced-motion: no-preference"
  );
  assert.match(
    primingRule[1],
    /--row-index/,
    "The reveal transition delay must derive from a per-row --row-index custom property"
  );
  assert.match(
    primingRule[1],
    /min\(var\(--row-index,\s*0\),\s*9\)/,
    "The stagger must be capped (min() clamp) rather than growing unbounded with row count"
  );
  assert.match(
    primingRule[2],
    /transition:\s*none/,
    "Entering the primed (hidden) state must be instant, never itself an animated hide"
  );

  // script.js: only ever primes a row when JS + IntersectionObserver +
  // no motion preference are all present (re-evaluated on every render
  // via a function, not captured once, so a runtime preference change
  // takes effect for the next render), always with a one-time observer
  // (unobserve on reveal) and a hard timeout safety net.
  assert.match(
    scriptSource,
    /function shouldAnimateProjectReveal\(\)\s*\{\s*return\s*!prefersReducedMotion\s*&&\s*supportsIntersectionObserver;/,
    "Reveal priming must be gated on both reduced-motion and IntersectionObserver support, re-evaluated per render"
  );
  assert.match(
    scriptSource,
    /const animateReveal = shouldAnimateProjectReveal\(\);/,
    "renderProjects must re-read the live reveal gate on every call, not a value captured once at load"
  );
  assert.match(
    scriptSource,
    /classList\.add\("is-priming"\)/,
    "script.js must prime rows for the bounded reveal"
  );
  assert.match(
    scriptSource,
    /observer\.unobserve\(entry\.target\)/,
    "Each row's reveal must be one-time (unobserve after it fires)"
  );
  assert.match(
    scriptSource,
    /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?classList\.remove\("is-priming"\)/,
    "script.js must include a timeout safety net that clears any stuck priming class"
  );
  assert.match(
    scriptSource,
    /function disarmProjectReveal\(\)\s*\{[\s\S]*?projectRevealObserver\?\.disconnect\(\);[\s\S]*?classList\.remove\("is-priming"\)/,
    "A runtime switch to reduced motion must disconnect the observer and clear any stale priming class"
  );
  assert.doesNotMatch(
    scriptSource,
    /\bprojectObserver\b|\bsetupProjectMotion\b|--project-index/,
    "script.js must not restore the old rejected reveal symbol names"
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

test("static redesign defers hero tilt runtime work to PR 2", async () => {
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");

  for (const deferredTiltPattern of [
    /flushTilt/,
    /resetHeroTilt/,
    /updateHeroTilt/,
    /--tilt-[xy]/,
    /--back-[xy]/,
    /\bis-tilting\b/,
    /pointermove/
  ]) {
    assert.doesNotMatch(
      scriptSource,
      deferredTiltPattern,
      `PR 1 must not retain deferred hero tilt runtime work: ${deferredTiltPattern}`
    );
    assert.doesNotMatch(
      stylesSource,
      deferredTiltPattern,
      `PR 1 styles must not retain deferred hero tilt hooks: ${deferredTiltPattern}`
    );
  }
});

test("scroll-progress is transform-based, progressive, non-essential, and stacks above the sticky header", async () => {
  const indexHtml = await readUtf8("index.html");
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");
  const tokensSource = await readUtf8("tokens.css");

  assert.match(
    indexHtml,
    /<div class="scroll-progress" aria-hidden="true">/,
    "index.html must contain the aria-hidden scroll-progress markup"
  );

  // Dedicated semantic z-index layer above --z-sticky (not borrowed
  // modal/toast semantics), so the progress bar reliably paints above
  // the sticky header regardless of DOM/source order — two elements
  // with an EQUAL z-index stack by DOM order, and the header (later in
  // the DOM than .scroll-progress) would otherwise always win and fully
  // occlude the bar.
  const zIndexOrder = ["--z-base", "--z-raised", "--z-dropdown", "--z-sticky", "--z-progress", "--z-modal"];
  const zIndexValues = new Map();
  for (const match of tokensSource.matchAll(/(--z-[a-z]+):\s*(\d+);/g)) {
    zIndexValues.set(match[1], Number(match[2]));
  }
  for (const tokenName of zIndexOrder) {
    assert.ok(zIndexValues.has(tokenName), `tokens.css must define ${tokenName}`);
  }
  assert.ok(
    zIndexValues.get("--z-progress") > zIndexValues.get("--z-sticky"),
    "--z-progress must be greater than --z-sticky so the progress bar paints above the sticky header"
  );
  assert.notEqual(
    zIndexValues.get("--z-progress"),
    zIndexValues.get("--z-modal"),
    "--z-progress must be its own dedicated token, not an alias for --z-modal semantics"
  );

  const scrollProgressRule = stylesSource.match(/\.scroll-progress\s*\{([^}]*)\}/)?.[1];
  assert.ok(scrollProgressRule, "styles.css must define .scroll-progress");
  assert.match(
    scrollProgressRule,
    /z-index:\s*var\(--z-progress\)/,
    ".scroll-progress must use the dedicated --z-progress token, not --z-sticky"
  );

  const siteHeaderRule = stylesSource.match(/\.site-header\s*\{([^}]*)\}/)?.[1];
  assert.ok(siteHeaderRule, "styles.css must define .site-header");
  assert.match(
    siteHeaderRule,
    /z-index:\s*var\(--z-sticky\)/,
    ".site-header must keep using --z-sticky (lower than --z-progress)"
  );

  const fillRule = stylesSource.match(/\.scroll-progress-fill\s*\{([^}]*)\}/s)?.[1];
  assert.ok(fillRule, "styles.css must define .scroll-progress-fill");
  assert.match(
    fillRule,
    /transform:\s*scaleX\(var\(--scroll-progress,\s*0\)\)/,
    "Scroll progress must be communicated via transform: scaleX, never width"
  );
  assert.doesNotMatch(
    fillRule,
    /\bwidth\s*:\s*var\(--scroll-progress/,
    "Scroll progress must never animate width (layout-triggering)"
  );

  assert.match(
    stylesSource,
    /@supports\s*\(animation-timeline:\s*scroll\(\)\)\s*\{[\s\S]*?animation-timeline:\s*scroll\(root\)/,
    "A CSS scroll-timeline enhancement must be layered on top of the JS fallback"
  );
  assert.match(
    stylesSource,
    /\.scroll-progress\s*\{\s*display:\s*none;\s*\}/,
    "The progress bar must be treated as non-essential and hidden under reduced motion"
  );

  assert.match(
    scriptSource,
    /function armScrollMotion\(\)\s*\{\s*if\s*\(scrollMotionArmed\s*\|\|\s*supportsScrollDrivenAnimations\)\s*\{\s*return;/,
    "Arming the JS scroll-progress fallback must be skipped/idempotent when native scroll-timelines apply or it is already armed"
  );
  assert.match(
    scriptSource,
    /if\s*\(!prefersReducedMotion\)\s*\{\s*armScrollMotion\(\);/,
    "Scroll motion must only be armed at load when the user has no reduced-motion preference"
  );
  assert.match(
    scriptSource,
    /requestAnimationFrame\(updateScrollMotion\)/,
    "Progress updates must be batched through requestAnimationFrame, not run directly on the scroll event"
  );
  assert.match(
    scriptSource,
    /addEventListener\("scroll",\s*requestScrollMotionUpdate,\s*\{\s*passive:\s*true\s*\}\)/,
    "The scroll listener must be passive"
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

test("rich redesign foundation uses local tokens and the marquee is footer-view-gated", async () => {
  const indexHtml = await readUtf8("index.html");
  const tokensSource = await readUtf8("tokens.css");
  const stylesSource = await readUtf8("styles.css");

  assert.match(
    indexHtml,
    /<link rel="stylesheet" href="tokens\.css" \/>\s*<link rel="stylesheet" href="styles\.css" \/>/,
    "Token stylesheet must load before the page stylesheet"
  );
  assert.doesNotMatch(
    indexHtml,
    /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
    "The design must not load a runtime third-party font"
  );
  assert.match(
    tokensSource,
    /@font-face[\s\S]*Big Shoulders Display[\s\S]*assets\/fonts\/BigShouldersDisplay-latin-variable\.woff2/,
    "The Latin display font must be served from the local artifact"
  );
  assert.match(
    tokensSource,
    /--color-accent:\s*oklch\(/,
    "Canonical design colors must be defined in tokens.css"
  );
  assert.match(
    stylesSource,
    /Hallmark · macrostructure: Marquee Hero[\s\S]*theme: Graphite Blue/,
    "Foundation CSS must record the selected marquee and theme system"
  );
  assert.match(
    stylesSource,
    /@keyframes\s+footer-marquee/,
    "The Ft8 marquee keyframe must exist now that PR 2's gated motion has landed"
  );
  assert.match(
    stylesSource,
    /\.footer-marquee-set\s*\{[^}]*animation-play-state:\s*paused;/s,
    "The marquee must default to paused, only running while the footer is in view"
  );
  await Promise.all([
    stat(path.join(repoRoot, "assets/fonts/BigShouldersDisplay-latin-variable.woff2")),
    stat(path.join(repoRoot, "assets/fonts/OFL.txt"))
  ]);
});

test("footer marquee loops seamlessly, stays accessible, and pauses off-view", async () => {
  const indexHtml = await readUtf8("index.html");
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  const marqueeSets = [...indexHtml.matchAll(/<span class="footer-marquee-set"[^>]*>/g)];
  assert.equal(
    marqueeSets.length,
    2,
    "The marquee track must contain exactly two duplicate sets for a seamless -100% loop"
  );
  assert.match(
    indexHtml,
    /<p class="sr-only" data-i18n="about\.statement">/,
    "A single static sr-only equivalent must remain outside the aria-hidden track"
  );
  assert.match(
    indexHtml,
    /<div class="footer-marquee-track" aria-hidden="true">/,
    "The duplicated track must stay aria-hidden from assistive technology"
  );

  assert.match(
    stylesSource,
    /@keyframes footer-marquee\s*\{\s*from\s*\{\s*transform:\s*translateX\(0\);\s*\}\s*to\s*\{\s*transform:\s*translateX\(-100%\);\s*\}\s*\}/,
    "The marquee must translate by -100% of its own set width for a seamless loop"
  );
  assert.match(
    stylesSource,
    /\.footer-marquee\.is-active\s+\.footer-marquee-set\s*\{\s*animation-play-state:\s*running;\s*\}/,
    "The marquee must only run while .footer-marquee carries the is-active class"
  );

  assert.match(
    scriptSource,
    /function armFooterMarquee\(\)\s*\{\s*if\s*\(!footerMarquee\s*\|\|\s*!supportsIntersectionObserver\s*\|\|\s*footerMarqueeObserver\)\s*\{\s*return;/,
    "Marquee activation must be gated on IntersectionObserver support and must be idempotent (no duplicate observers on repeated arms)"
  );
  assert.match(
    scriptSource,
    /if\s*\(!prefersReducedMotion\)\s*\{\s*armScrollMotion\(\);\s*armFooterMarquee\(\);\s*\}/,
    "The marquee must only be armed at load when the user has no reduced-motion preference"
  );
  assert.match(
    scriptSource,
    /function disarmFooterMarquee\(\)\s*\{\s*footerMarqueeObserver\?\.disconnect\(\);\s*footerMarqueeObserver = null;/,
    "A runtime switch to reduced motion must disconnect the marquee observer and reset it to null (safe to re-arm later)"
  );
  assert.match(
    scriptSource,
    /footerIntersecting\s*&&\s*document\.visibilityState\s*===\s*"visible"/,
    "The marquee must only be active while both in view and the tab is visible"
  );
  assert.match(
    scriptSource,
    /addEventListener\("visibilitychange",\s*syncFooterMarqueeActive\)/,
    "The marquee must re-evaluate on visibilitychange to pause in background tabs"
  );
});

test("every desktop project row keeps the image on the left, in DOM order", async () => {
  const stylesSource = await readUtf8("styles.css");
  const projects = JSON.parse(await readUtf8("projects.json"));

  const desktopBlock = stylesSource.match(
    /@media\s*\(min-width:\s*48rem\)\s*\{([\s\S]*)\}\s*@media\s*\(prefers-reduced-motion:\s*reduce\)/
  )?.[1];
  assert.ok(desktopBlock, "Expected a min-width: 48rem media query block");

  assert.doesNotMatch(
    desktopBlock,
    /\.project-row:nth-child\((?:even|odd)\)\s+\.project-media/,
    "No nth-child rule may move .project-media to a different grid column/row on desktop"
  );
  assert.doesNotMatch(
    desktopBlock,
    /\.project-row:nth-child\((?:even|odd)\)\s+\.project-content/,
    "No nth-child rule may move .project-content to a different grid column/row on desktop"
  );
  assert.match(
    desktopBlock,
    /\.project-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s*minmax\(0,\s*1\.1fr\);/s,
    "Desktop rows must use a fixed two-column grid: media first (left), content second (right)"
  );

  // The odd/even accent-color scene variation must still be present and
  // untouched — only the column swap is removed.
  assert.match(
    stylesSource,
    /\.project-row:nth-child\(odd\)\s*\{\s*background:\s*var\(--color-accent\);/,
    "Odd-row accent color variation must still exist"
  );
  assert.match(
    stylesSource,
    /\.project-row:nth-child\(even\)\s*\{\s*background:\s*var\(--color-accent-2\);/,
    "Even-row accent-2 color variation must still exist"
  );

  assert.ok(projects.length >= 2, "Expected at least two projects to validate row order against");
});

test("headings wrap intentionally: safety-net overflow-wrap, language-aware breaking, balance retained", async () => {
  const stylesSource = await readUtf8("styles.css");

  const headingSelectors = [
    /\.hero h1\s*\{([^}]*)\}/s,
    /\.section-heading h2,\s*\n\.projects-intro h2,\s*\n\.contact h2\s*\{([^}]*)\}/s,
    /\.project-heading h3\s*\{([^}]*)\}/s
  ];

  for (const selectorPattern of headingSelectors) {
    const ruleBody = stylesSource.match(selectorPattern)?.[1];
    assert.ok(ruleBody, `Expected to find heading rule for pattern: ${selectorPattern}`);
    assert.doesNotMatch(
      ruleBody,
      /overflow-wrap:\s*anywhere/,
      "overflow-wrap: anywhere must not be the primary wrapping behavior on display headings"
    );
    assert.match(
      ruleBody,
      /overflow-wrap:\s*break-word/,
      "Headings must keep overflow-wrap: break-word as a true-overflow safety net"
    );
    assert.match(
      ruleBody,
      /text-wrap:\s*balance/,
      "Headings must keep text-wrap: balance for even line lengths"
    );
  }

  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+:where\(\.project-heading h3,\s*\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*word-break:\s*keep-all;/,
    "Non-hero Japanese display headings must use word-break: keep-all so words don't split mid-character-group"
  );
  assert.match(
    stylesSource,
    /:where\(\.project-heading h3,\s*\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*hyphens:\s*auto;/,
    "Non-hero headings must have a hyphens: auto safety net for long Latin words"
  );
});

test("hero entrance runs from .js-enabled alone with no script.js dependency, and LCP image stays untouched", async () => {
  const stylesSource = await readUtf8("styles.css");
  const tokensSource = await readUtf8("tokens.css");

  const entranceRule = stylesSource.match(
    /\.js-enabled \.hero h1 span,\s*\n\.js-enabled \.hero-support > \*\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(entranceRule, "Expected a combined .js-enabled hero entrance rule");
  assert.match(entranceRule, /opacity:\s*0;/, "Hero entrance must start from opacity: 0");
  assert.match(
    entranceRule,
    /transform:\s*translateY\(var\(--reveal-offset\)\)/,
    "Hero entrance must use a transform, not a layout property, for its offset"
  );
  assert.match(
    entranceRule,
    /animation:\s*hero-reveal\s+var\(--dur-long\)\s+var\(--ease-out\)\s+forwards/,
    "Hero entrance must be driven by a forwards-filling CSS animation"
  );

  // Total choreography must land in the 500-800ms window: last delay
  // (280ms) + duration (--dur-long, 420ms) = 700ms.
  assert.match(tokensSource, /--dur-long:\s*420ms/, "dur-long token must still be 420ms");
  assert.match(
    stylesSource,
    /\.js-enabled \.hero-support > \*:nth-child\(3\)\s*\{\s*animation-delay:\s*280ms;\s*\}/,
    "The last staggered hero element must land within the 500-800ms budget"
  );

  assert.doesNotMatch(
    stylesSource,
    /\.hero-visual(?:\s+img)?\s*\{[^}]*animation:/,
    "The hero visual frame/img must never carry an entrance animation (protects LCP)"
  );
});

test("nav compact morph is paint-only and never shifts header layout or touch targets", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  const compactRule = stylesSource.match(/\.site-header\.is-compact\s*\{([^}]*)\}/)?.[1];
  assert.ok(compactRule, "Expected a .site-header.is-compact rule");
  assert.doesNotMatch(
    compactRule,
    /\b(?:min-height|height|padding|margin|border-width)\s*:/,
    "Compact nav state must not touch box-model properties that would shift layout"
  );
  assert.match(compactRule, /background-color:/, "Compact state must be signalled via background-color");

  const wordmarkCompactRule = stylesSource.match(
    /\.site-header\.is-compact \.wordmark-mark\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(wordmarkCompactRule, "Expected a compact wordmark-mark transform rule");
  assert.match(wordmarkCompactRule, /transform:/, "Compact wordmark-mark treatment must use transform only");

  // The clickable wordmark link itself must never be scaled (44px target).
  assert.doesNotMatch(
    stylesSource,
    /\.site-header\.is-compact \.wordmark\s*\{[^}]*transform:/,
    "The wordmark link (the 44px touch target) must never be transformed by the compact state"
  );

  assert.match(
    scriptSource,
    /heroObserver\.observe\(heroSection\)/,
    "script.js must observe the hero section to drive the compact morph"
  );
  assert.match(
    scriptSource,
    /siteHeader\.classList\.toggle\("is-compact",\s*!entry\.isIntersecting\)/,
    "The compact class must toggle based on the hero's intersection state"
  );
});

test("micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");
  const tokensSource = await readUtf8("tokens.css");

  assert.match(
    tokensSource,
    /--parallax-distance:\s*5px;/,
    "tokens.css must cap parallax distance at 5px"
  );

  const noPreferenceBlock = stylesSource.match(
    /@media \(prefers-reduced-motion: no-preference\) \{\s*\.project-media\s*\{\s*transform:\s*translateY\(var\(--parallax-y,\s*0px\)\);/
  );
  assert.ok(noPreferenceBlock, "Parallax transform fallback must be scoped to prefers-reduced-motion: no-preference");

  assert.doesNotMatch(
    stylesSource,
    /\.project-media img\s*\{[^}]*--parallax-y/,
    "Parallax must never apply to .project-media img (would collide with its own hover scale)"
  );

  assert.match(
    stylesSource,
    /@supports \(animation-timeline: view\(\)\)\s*\{[\s\S]*?animation-timeline:\s*view\(\);/,
    "A compositor-driven view-timeline enhancement must be layered on top of the JS fallback"
  );

  assert.match(
    scriptSource,
    /--parallax-y/,
    "The shared rAF fallback must drive --parallax-y"
  );
  assert.doesNotMatch(
    scriptSource,
    /querySelectorAll\(["']\.project-media["']\)[\s\S]{0,80}addEventListener\(\s*["']scroll["']/,
    "Parallax must not attach a per-element scroll listener"
  );
});

test("reduced motion nulls every new spatial transform, disables non-essential motion, and keeps the wordmark-mark rotation invariant", async () => {
  const stylesSource = await readUtf8("styles.css");

  const reducedBlock = stylesSource.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\}\s*@media \(forced-colors: active\)/
  )?.[1];
  assert.ok(reducedBlock, "Expected a prefers-reduced-motion: reduce block before the forced-colors block");

  assert.match(
    reducedBlock,
    /\.hero h1 span,\s*\n\s*\.hero-support > \*,\s*\n\s*\.project-row,\s*\n\s*\.project-media\s*\{\s*transform:\s*none\s*!important;/,
    "Reduced motion must null transform on every new PR 2 spatial motion surface"
  );

  // Regression: the wordmark-mark's static rotate(12deg) predates PR 2.
  // Nulling it to "none" only in the .is-compact state (while the
  // resting state keeps rotate(12deg)) creates a visible, scroll-
  // triggered rotation under reduced motion every time is-compact
  // toggles. Both states must keep the identical static rotation, and
  // the transition itself must be removed (not just capped to 150ms).
  assert.doesNotMatch(
    reducedBlock,
    /\.site-header\.is-compact \.wordmark-mark\s*\{\s*transform:\s*none/,
    "Reduced motion must not null the wordmark-mark's static rotation in the compact state alone"
  );
  const wordmarkRule = reducedBlock.match(
    /\.wordmark-mark,\s*\n\s*\.site-header\.is-compact \.wordmark-mark\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(
    wordmarkRule,
    "Reduced motion must define one combined rule for .wordmark-mark and .site-header.is-compact .wordmark-mark"
  );
  assert.match(
    wordmarkRule,
    /transform:\s*rotate\(12deg\)\s*!important;/,
    "Both the resting and compact wordmark-mark states must keep the identical static rotate(12deg) under reduced motion"
  );
  assert.match(
    wordmarkRule,
    /transition:\s*none\s*!important;/,
    "The wordmark-mark transition must be fully removed under reduced motion, not merely shortened"
  );

  assert.match(
    reducedBlock,
    /\.scroll-progress\s*\{\s*display:\s*none;\s*\}/,
    "The scroll progress bar must be hidden outright under reduced motion"
  );
  assert.match(
    reducedBlock,
    /\.footer-marquee-set\s*\{\s*animation:\s*none\s*!important;/,
    "The marquee animation must be fully disabled under reduced motion"
  );
});

test("reduced motion preference is live: a runtime change arms/disarms motion without duplicate observers", async () => {
  const scriptSource = await readUtf8("script.js");

  assert.match(
    scriptSource,
    /const motionQuery = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\);/,
    "script.js must keep a live MediaQueryList for prefers-reduced-motion, not just read .matches once"
  );
  assert.match(
    scriptSource,
    /let prefersReducedMotion = motionQuery\.matches;/,
    "prefersReducedMotion must be reassignable (let), updated by the change listener"
  );

  const changeHandler = scriptSource.match(
    /function handleMotionPreferenceChange\(event\)\s*\{([\s\S]*?)\n\s*\}/
  )?.[1];
  assert.ok(changeHandler, "Expected a handleMotionPreferenceChange function");
  assert.match(
    changeHandler,
    /prefersReducedMotion = event\.matches;/,
    "The change handler must update the live prefersReducedMotion flag from the event"
  );
  assert.match(
    changeHandler,
    /disarmScrollMotion\(\);[\s\S]*disarmFooterMarquee\(\);[\s\S]*disarmProjectReveal\(\);/,
    "Switching to reduced motion must immediately disarm scroll motion, the marquee, and any priming project rows"
  );
  assert.match(
    changeHandler,
    /armScrollMotion\(\);[\s\S]*armFooterMarquee\(\);/,
    "Switching back to no-preference must re-arm scroll motion and the marquee"
  );

  assert.match(
    scriptSource,
    /motionQuery\.addEventListener\("change",\s*handleMotionPreferenceChange\)/,
    "script.js must subscribe to live prefers-reduced-motion changes"
  );

  // Idempotency: repeated arm calls must not attach duplicate listeners
  // or create duplicate observers.
  assert.match(
    scriptSource,
    /function armScrollMotion\(\)\s*\{\s*if\s*\(scrollMotionArmed \|\| supportsScrollDrivenAnimations\)\s*\{\s*return;/,
    "armScrollMotion must guard against being armed twice"
  );
  assert.match(
    scriptSource,
    /function armFooterMarquee\(\)\s*\{\s*if\s*\(!footerMarquee \|\| !supportsIntersectionObserver \|\| footerMarqueeObserver\)\s*\{\s*return;/,
    "armFooterMarquee must guard against creating a second observer while one is already active"
  );
  assert.match(
    scriptSource,
    /function disarmScrollMotion\(\)\s*\{\s*if\s*\(!scrollMotionArmed\)\s*\{\s*return;/,
    "disarmScrollMotion must be a no-op when not currently armed"
  );
});

// OKLCH -> linear sRGB -> WCAG relative luminance, used to compute real
// contrast ratios for token pairs below (not string-only checks).
function parseOklchTokens(tokensSource) {
  const tokens = new Map();
  const tokenPattern = /(--color-[a-z0-9-]+):\s*oklch\((\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\)/g;
  for (const match of tokensSource.matchAll(tokenPattern)) {
    const [, name, l, c, h] = match;
    tokens.set(name, [Number(l) / 100, Number(c), Number(h)]);
  }
  return tokens;
}

function relativeLuminanceFromOklch([L, C, Hdeg]) {
  const hRad = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(bl);
}

function oklchContrastRatio(tokenA, tokenB) {
  const la = relativeLuminanceFromOklch(tokenA);
  const lb = relativeLuminanceFromOklch(tokenB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

test("focus-ring outline-color is scoped to controls whose own accent fill sits under the offset ring", async () => {
  const stylesSource = await readUtf8("styles.css");

  // The accent-ink override must apply ONLY to the two contexts where the
  // 3px outline-offset ring lands within the parent's own accent-filled
  // padding (project-row odd rows, contact panel) — not to controls whose
  // offset ring is painted over dark paper/paper-3 (menu-toggle,
  // language-toggle, button-primary, retry-button), where accent-ink would
  // be near-invisible against the backdrop.
  const accentInkRuleMatch = stylesSource.match(
    /([^{}]+)\{\s*outline-color:\s*var\(--color-accent-ink\);\s*\}/
  );
  assert.ok(accentInkRuleMatch, "Expected an outline-color: var(--color-accent-ink) rule in styles.css");
  const accentInkSelectorList = accentInkRuleMatch[1];

  const mustInclude = [
    ".project-row:nth-child(odd) :where(a, button):focus-visible",
    ".contact-panel :where(a, button):focus-visible"
  ];
  for (const selector of mustInclude) {
    assert.ok(
      accentInkSelectorList.includes(selector),
      `accent-ink outline-color rule must still cover "${selector}" (ring lands on its own accent padding)`
    );
  }

  const mustExclude = [
    ".menu-toggle:focus-visible",
    ".language-toggle:focus-visible",
    ".button-primary:focus-visible",
    ".retry-button:focus-visible"
  ];
  for (const selector of mustExclude) {
    assert.ok(
      !accentInkSelectorList.includes(selector),
      `accent-ink outline-color rule must NOT cover "${selector}" — its offset ring is painted over dark paper/paper-3, not its own accent fill`
    );
  }

  // The .language-toggle exclusion on the on-dark override must remain so
  // that .language-toggle falls through to the default --color-focus ring
  // from :where(a, button):focus-visible instead of inheriting on-dark via
  // the broader .js-enabled .nav-menu :focus-visible selector.
  assert.match(
    stylesSource,
    /\.js-enabled \.nav-menu :focus-visible:not\(\.language-toggle\)/,
    "on-dark override must keep excluding .language-toggle so it falls through to the default focus ring"
  );
});

test("focus-ring / backdrop token pairings meet WCAG 1.4.11 non-text contrast (>= 3:1)", async () => {
  const tokensSource = await readUtf8("tokens.css");
  const tokens = parseOklchTokens(tokensSource);

  const required = [
    "--color-focus",
    "--color-accent-ink",
    "--color-on-dark",
    "--color-paper",
    "--color-paper-3",
    "--color-accent",
    "--color-accent-2"
  ];
  for (const name of required) {
    assert.ok(tokens.has(name), `Expected ${name} to be defined as oklch(...) in tokens.css`);
  }

  // Real ring/backdrop pairings for every focus-visible selector in
  // styles.css, derived from each control's actual DOM ancestor background
  // (not the control's own fill), so a future palette edit that shifts
  // these tokens will fail loudly instead of silently regressing contrast.
  const pairings = [
    // .menu-toggle sits directly in .site-header (background: paper), zero
    // own padding, default focus ring (base :where(a,button) rule).
    { label: ".menu-toggle ring vs .site-header (paper)", ring: "--color-focus", backdrop: "--color-paper" },
    // .button-primary sits in .hero, which has no bg override -> body bg (paper).
    { label: ".button-primary ring vs body (paper)", ring: "--color-focus", backdrop: "--color-paper" },
    // .retry-button sits in .projects-status/.projects-noscript, which
    // inherit .projects background (paper-3).
    { label: ".retry-button ring vs .projects (paper-3)", ring: "--color-focus", backdrop: "--color-paper-3" },
    // .language-toggle's immediate parent is .nav-menu: paper-3 in the
    // mobile open-dropdown state, transparent-over-paper (site-header) at
    // desktop. Both must pass with the default focus ring.
    { label: ".language-toggle ring vs .nav-menu mobile (paper-3)", ring: "--color-focus", backdrop: "--color-paper-3" },
    { label: ".language-toggle ring vs .site-header desktop (paper)", ring: "--color-focus", backdrop: "--color-paper" },
    // .project-row:nth-child(odd) and .contact-panel fill their own
    // generous padding with accent, so the offset ring lands on accent.
    { label: ".project-row odd ring vs own accent fill", ring: "--color-accent-ink", backdrop: "--color-accent" },
    { label: ".contact-panel ring vs own accent fill", ring: "--color-accent-ink", backdrop: "--color-accent" },
    // .project-row:nth-child(even) uses on-dark against its own accent-2 fill.
    { label: ".project-row even ring vs own accent-2 fill", ring: "--color-on-dark", backdrop: "--color-accent-2" }
  ];

  for (const { label, ring, backdrop } of pairings) {
    const ratio = oklchContrastRatio(tokens.get(ring), tokens.get(backdrop));
    assert.ok(
      ratio >= 3,
      `${label} must meet >= 3:1 non-text contrast, got ${ratio.toFixed(2)}:1`
    );
  }
});

test("color-scheme metadata matches the shipped dark-only theme", async () => {
  const indexHtml = await readUtf8("index.html");

  assert.match(
    indexHtml,
    /<meta name="color-scheme" content="dark" \/>/,
    'color-scheme metadata must declare "dark" to match the single dark Graphite Blue theme'
  );
  assert.doesNotMatch(
    indexHtml,
    /<meta name="color-scheme" content="(?:light|dark light|light dark)" \/>/,
    "color-scheme must not claim a light variant while none is shipped"
  );
});
